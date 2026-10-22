import ts from 'typescript'

const deploymentFields = new Set([
  'INKCRE_PGREST_URL',
  'INKCRE_JWT_SECRET',
  'INKCRE_PEER_ID',
  'INKCRE_CLIENT_ID',
  'extension_registry_url',
  'telemetry_peer_relay_url',
])

function nameOf(node) {
  if (!node) return undefined
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isElementAccessExpression(node)) return nameOf(node.argumentExpression)
  return undefined
}

// TypeScript owns lexical binding, including shadowed names; imports remain outside this file.
function sourceStringInspector(file) {
  let checker
  function constantInitializer(identifier) {
    if (!checker) {
      const options = { noLib: true, noResolve: true, allowJs: true, allowNonTsExtensions: true }
      const host = ts.createCompilerHost(options)
      host.getSourceFile = (name) => (name === file.fileName ? file : undefined)
      checker = ts.createProgram([file.fileName], options, host).getTypeChecker()
    }
    const declaration = checker.getSymbolAtLocation(identifier)?.valueDeclaration
    return declaration &&
      ts.isVariableDeclaration(declaration) &&
      ts.isVariableDeclarationList(declaration.parent) &&
      declaration.parent.flags & ts.NodeFlags.Const
      ? declaration.initializer
      : undefined
  }

  function fixedStrings(node, seen = new Set()) {
    if (!node || seen.has(node)) return []
    seen = new Set(seen).add(node)
    if (ts.isStringLiteralLike(node)) return [node.text]
    if (ts.isIdentifier(node)) return fixedStrings(constantInitializer(node), seen)
    if (ts.isTemplateExpression(node)) {
      let values = [node.head.text]
      for (const span of node.templateSpans)
        values = values.flatMap((value) =>
          fixedStrings(span.expression, seen).map((part) => value + part + span.literal.text)
        )
      return values
    }
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isNonNullExpression(node)
    )
      return fixedStrings(node.expression, seen)
    if (ts.isConditionalExpression(node))
      return [...fixedStrings(node.whenTrue, seen), ...fixedStrings(node.whenFalse, seen)]
    if (ts.isBinaryExpression(node)) {
      const left = fixedStrings(node.left, seen)
      const right = fixedStrings(node.right, seen)
      if (node.operatorToken.kind === ts.SyntaxKind.PlusToken)
        return left.flatMap((a) => right.map((b) => a + b))
      if (
        node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      )
        return [...left, ...right]
    }
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      if (!ts.isBlock(node.body)) return fixedStrings(node.body, seen)
      return node.body.statements.flatMap((statement) =>
        ts.isReturnStatement(statement) ? fixedStrings(statement.expression, seen) : []
      )
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      if (['default', 'catch'].includes(node.expression.name.text))
        return fixedStrings(node.arguments[0], seen)
      if (node.expression.name.text === 'preprocess') return fixedStrings(node.arguments[1], seen)
      // Schema metadata and transforms do not turn help text into configuration defaults.
      return fixedStrings(node.expression.expression, seen)
    }
    if (ts.isNewExpression(node) && nameOf(node.expression) === 'URL') {
      const paths = fixedStrings(node.arguments?.[0], seen)
      const bases = node.arguments?.[1] ? fixedStrings(node.arguments[1], seen) : [undefined]
      return paths.flatMap((path) =>
        bases.flatMap((base) => {
          try {
            return [new URL(path, base).href]
          } catch {
            return []
          }
        })
      )
    }
    if (ts.isPropertyAccessExpression(node) && ['href', 'origin'].includes(node.name.text))
      return fixedStrings(node.expression, seen)
    return []
  }

  return fixedStrings
}

/** Inspect configuration writes and InKCre infrastructure arguments, never arbitrary URLs. */
export function inspectBrowserRuntimeSource(source, filename) {
  const errors = []
  const scripts = filename.endsWith('.vue')
    ? [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/g)].map(
        (match) =>
          '\n'.repeat(
            source.slice(0, match.index + match[0].indexOf('>') + 1).split('\n').length - 1
          ) + match[1]
      )
    : [source]
  for (const script of scripts) {
    const file = ts.createSourceFile(filename, script, ts.ScriptTarget.Latest, true)
    const fixedStrings = sourceStringInspector(file)
    const imports = new Map()
    for (const statement of file.statements) {
      if (!ts.isImportDeclaration(statement)) continue
      const bindings = statement.importClause?.namedBindings
      if (bindings && ts.isNamedImports(bindings))
        for (const binding of bindings.elements)
          imports.set(binding.name.text, (binding.propertyName ?? binding.name).text)
    }
    function rejectBootstrap(expression) {
      for (const value of fixedStrings(expression)) {
        if (value === '/api/config')
          errors.push(`${filename} uses the retired /api/config runtime-config channel`)
        if (value.startsWith('https://raw.githubusercontent.com/stopwords-iso/'))
          errors.push(`${filename} fetches the retired mutable stopword bootstrap fallback`)
      }
    }
    function rejectFixed(expression, boundary) {
      if (!fixedStrings(expression).some((value) => value !== '')) return
      const { line } = file.getLineAndCharacterOfPosition(expression.getStart(file))
      errors.push(`${filename}:${line + 1} hardcodes ${boundary}; use runtime-owned configuration`)
    }
    function visit(node) {
      if (
        ts.isPropertyAssignment(node) ||
        ts.isVariableDeclaration(node) ||
        ts.isPropertyDeclaration(node) ||
        ts.isBindingElement(node) ||
        ts.isParameter(node)
      ) {
        const field = nameOf(
          ts.isBindingElement(node) ? (node.propertyName ?? node.name) : node.name
        )
        if (deploymentFields.has(field)) rejectFixed(node.initializer, field)
      }
      if (
        ts.isBinaryExpression(node) &&
        [
          ts.SyntaxKind.EqualsToken,
          ts.SyntaxKind.BarBarEqualsToken,
          ts.SyntaxKind.QuestionQuestionEqualsToken,
        ].includes(node.operatorToken.kind)
      ) {
        const field = nameOf(node.left)
        if (deploymentFields.has(field)) rejectFixed(node.right, field)
      }
      if (ts.isNewExpression(node)) {
        const name = imports.get(nameOf(node.expression)) ?? nameOf(node.expression)
        if (name === 'Request') rejectBootstrap(node.arguments?.[0])
        if (name === 'DBAPIClient') rejectFixed(node.arguments?.[3], 'DBAPIClient base URL')
        if (name === 'PostgrestClient') rejectFixed(node.arguments?.[0], 'PostgREST base URL')
        if (name === 'ExtensionRegistryOriginResolver')
          rejectFixed(node.arguments?.[0], 'Peer Registry override')
      }
      if (ts.isCallExpression(node)) {
        const name = imports.get(nameOf(node.expression)) ?? nameOf(node.expression)
        if (name === 'signDatabaseToken') rejectFixed(node.arguments[0], 'database JWT secret')
        if (
          name === 'useWebExtensionStorage' &&
          fixedStrings(node.arguments[0]).includes('inkcreApi')
        )
          rejectFixed(node.arguments[1], 'browser-extension API default')
        if (
          name === 'rawPostgrestFetch' &&
          node.arguments[1] &&
          ts.isObjectLiteralExpression(node.arguments[1])
        ) {
          for (const property of node.arguments[1].properties)
            if (ts.isPropertyAssignment(property) && nameOf(property.name) === 'baseUrl')
              rejectFixed(property.initializer, 'PostgREST base URL')
        }
        if (name === 'fetch') rejectBootstrap(node.arguments[0])
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
  }
  if (source.includes('VITE_INKCRE_JWT_SECRET'))
    errors.push(`${filename} contains the build-supplied JWT credential channel`)
  return [...new Set(errors)]
}

/** Deployment leak fingerprints survive minification; public hosting domains are not fingerprints. */
export function inspectBrowserArtifact(content) {
  const forbiddenTerms = new Map([
    ['VITE_INKCRE_JWT_SECRET', 'build-supplied JWT credential channel'],
    ['063cd1df-c495-5006-a119-67aa633b26be', 'environment-specific client identity'],
    ['1eaaadc6-2c1d-4515-ad06-22905dc890a9', 'legacy environment client identity'],
  ])
  const errors = [...forbiddenTerms].flatMap(([term, reason]) =>
    content.includes(term) ? [reason] : []
  )
  if (/(?:["'`]|\\["'])\/api\/config(?:["'`]|\\["'])/.test(content))
    errors.push('retired /api/config runtime-config channel')
  return errors
}
