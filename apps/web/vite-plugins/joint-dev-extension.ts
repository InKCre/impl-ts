// joint-dev-extension.ts
import { spawn } from 'node:child_process'
import path from 'path'
import fs from 'fs'
import { Plugin, ViteDevServer, createServer } from 'vite'
import getPort from 'get-port'
import colors from 'picocolors'
import sirv from 'sirv'

interface ExtensionDevOptions {
  dir?: string // 扩展根目录，默认为 "extensions"
  active: string[] // 需要 Dev 的扩展 ID 列表
  exclude?: string[] // 排除的扩展 ID 列表
}

interface ExtensionInfo {
  id: string
  dir: string
  mode: 'dev' | 'static'
  port?: number // 仅 dev 模式有
}

function buildExtension(extension: ExtensionInfo) {
  return new Promise<void>((resolve, reject) => {
    const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
    const child = spawn(pnpm, ['run', 'build'], {
      cwd: extension.dir,
      env: process.env,
      stdio: 'inherit',
    })

    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(
        new Error(
          signal
            ? `extension build stopped by ${signal}`
            : `extension build exited with code ${code ?? 'unknown'}`
        )
      )
    })
  })
}

export async function useExtensionDevServer(options: ExtensionDevOptions) {
  const rootDir = process.cwd()
  const extBaseDir = path.resolve(rootDir, options.dir || 'extensions')
  const excludeList = new Set(options.exclude || [])
  const activeSet = new Set(options.active)

  // 1. 扫描并分类扩展
  const extensions: ExtensionInfo[] = []

  if (fs.existsSync(extBaseDir)) {
    const items = fs.readdirSync(extBaseDir, { withFileTypes: true })

    // 预留端口起始点
    let portCursor = 4000

    for (const item of items) {
      if (
        !item.isDirectory() ||
        excludeList.has(item.name) ||
        item.name.startsWith('.') ||
        item.name === 'node_modules'
      )
        continue

      const extId = item.name
      const extDir = path.join(extBaseDir, extId)
      const isDev = activeSet.has(extId)

      // 如果是 Dev 模式，分配端口
      let port: number | undefined
      if (isDev) {
        port = await getPort({ port: portCursor })
        portCursor = port + 1
      }

      extensions.push({
        id: extId,
        dir: extDir,
        mode: isDev ? 'dev' : 'static',
        port,
      })
    }
  }

  // 2. 生成 Proxy 配置 (仅针对 Dev 模式)
  const proxyConfig: Record<string, any> = {}
  extensions
    .filter((e) => e.mode === 'dev')
    .forEach((e) => {
      // 这里的路径规则根据你的实际需求调整
      proxyConfig[`^/${e.id}/web`] = {
        target: `http://localhost:${e.port}`,
        changeOrigin: true,
      }
    })

  const plugin: Plugin = {
    name: 'vite-plugin-extension-manager',

    // 注入 Proxy
    config(config) {
      return {
        server: {
          proxy: {
            ...config.server?.proxy,
            ...proxyConfig,
          },
        },
      }
    },

    configureServer(server: ViteDevServer) {
      const subServers: ViteDevServer[] = []

      // A. 处理 Static 模式：检查构建 + 注册中间件
      const setupStaticExtensions = async () => {
        const staticExts = extensions.filter((e) => e.mode === 'static')

        if (staticExts.length > 0) {
          console.log(
            colors.blue(
              `\n📦 [Extension Manager] Checking builds for ${staticExts.length} static extensions...`
            )
          )
        }

        for (const ext of staticExts) {
          const outDir = path.join(ext.dir, 'dist/web')
          const entryFile = path.join(outDir, 'index.html')

          // 1. 如果没有构建产物，自动执行构建
          if (!fs.existsSync(entryFile)) {
            console.log(colors.yellow(`  ⚡ [${ext.id}] Build missing, building now...`))
            try {
              // Module Federation generates virtual modules in process-global paths.
              // Isolate its build from the already-running host Vite process.
              await buildExtension(ext)
              console.log(colors.green(`  ✅ [${ext.id}] Built successfully.`))
            } catch (e) {
              console.error(colors.red(`  ❌ [${ext.id}] Build failed.`), e)
              continue // 构建失败则跳过挂载
            }
          }

          // 2. 注册静态文件中间件 (使用 sirv)
          // 拦截路径: /extension-id/web/...
          const routePrefix = `/${ext.id}/web`

          // sirv 实例 (dev 模式下开启 etag 等)
          const serve = sirv(outDir, { dev: true, single: true })

          server.middlewares.use((req, res, next) => {
            if (req.url?.startsWith(routePrefix)) {
              // URL Rewrite: 把 /extension-a/web/assets/app.js 变成 /assets/app.js
              const originalUrl = req.url
              req.url = req.url.slice(routePrefix.length)
              if (req.url === '') req.url = '/' // 处理根路径

              serve(req, res, () => {
                // 如果 sirv 没找到文件（404），还原 URL 并交给下一个中间件
                // 这样避免因为 rewrite 导致其他中间件逻辑混乱
                req.url = originalUrl
                next()
              })
            } else {
              next()
            }
          })
        }
      }

      // B. 处理 Dev 模式：启动子 Server
      const startDevServers = async () => {
        const devExts = extensions.filter((e) => e.mode === 'dev')
        if (devExts.length === 0) return

        console.log(
          colors.cyan(`\n🚀 [Extension Manager] Starting ${devExts.length} dev servers...`)
        )

        for (const ext of devExts) {
          try {
            const subServer = await createServer({
              root: ext.dir,
              configFile: path.resolve(ext.dir, 'vite.config.ts'),
              server: {
                port: ext.port,
                strictPort: true,
                hmr: { port: ext.port },
                middlewareMode: false,
              },
              logLevel: 'error', // 仅显示错误，避免刷屏
            })

            await subServer.listen()
            subServers.push(subServer)

            console.log(
              colors.green(`  ➜ [${ext.id}] Dev Server: `) +
                colors.gray(`http://localhost:${ext.port}`)
            )
          } catch (e) {
            console.error(colors.red(`❌ [${ext.id}] Failed to start dev server:`), e)
          }
        }
      }

      const cleanup = async () => {
        await Promise.all(subServers.map((s) => s.close()))
        subServers.length = 0
      }

      // 执行初始化流程
      // 注意：这里建议 await setupStaticExtensions，因为构建可能需要一点时间，
      // 我们希望构建完成后主服务才算完全 ready。
      // startDevServers 可以异步跑。

      // 我们将其包装在一个 async IIFE 中以免阻塞 configureServer 的同步返回值
      void (async () => {
        await setupStaticExtensions()
        await startDevServers()
      })().catch((error) => {
        server.config.logger.error(`Failed to start joint extension development: ${error}`)
      })

      server.httpServer?.on('close', cleanup)
      process.once('exit', cleanup)
    },
  }

  return { plugin }
}
