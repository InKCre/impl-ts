export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  inkcre: {
    Tables: {
      agents: {
        Row: {
          created_at: string
          id: number
          max_model_calls_per_turn: number
          model: number
          name: string
          system_prompt: string
          tool_choice: Json | null
          tools: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: number
          max_model_calls_per_turn: number
          model: number
          name: string
          system_prompt: string
          tool_choice?: Json | null
          tools?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: number
          max_model_calls_per_turn?: number
          model?: number
          name?: string
          system_prompt?: string
          tool_choice?: Json | null
          tools?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'agents_model_fkey'
            columns: ['model']
            isOneToOne: false
            referencedRelation: 'ai_models'
            referencedColumns: ['id']
          },
        ]
      }
      ai_dialects: {
        Row: {
          config_schema: Json
          description: string
          id: string
        }
        Insert: {
          config_schema?: Json
          description: string
          id: string
        }
        Update: {
          config_schema?: Json
          description?: string
          id?: string
        }
        Relationships: []
      }
      ai_models: {
        Row: {
          capabilities: Json
          created_at: string
          enabled: boolean
          id: number
          name: string | null
          native_model_id: string
          provider: number
          updated_at: string
        }
        Insert: {
          capabilities: Json
          created_at?: string
          enabled?: boolean
          id?: number
          name?: string | null
          native_model_id: string
          provider: number
          updated_at?: string
        }
        Update: {
          capabilities?: Json
          created_at?: string
          enabled?: boolean
          id?: number
          name?: string | null
          native_model_id?: string
          provider?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'ai_models_provider_fkey'
            columns: ['provider']
            isOneToOne: false
            referencedRelation: 'ai_providers'
            referencedColumns: ['id']
          },
        ]
      }
      ai_providers: {
        Row: {
          config: Json
          created_at: string
          dialect: string
          enabled: boolean
          id: number
          name: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          dialect: string
          enabled?: boolean
          id?: number
          name: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          dialect?: string
          enabled?: boolean
          id?: number
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'ai_providers_dialect_fkey'
            columns: ['dialect']
            isOneToOne: false
            referencedRelation: 'ai_dialects'
            referencedColumns: ['id']
          },
        ]
      }
      block_embeddings: {
        Row: {
          block: number
          created_at: string
          embedding: string
          profile: number
          updated_at: string
        }
        Insert: {
          block: number
          created_at?: string
          embedding: string
          profile: number
          updated_at?: string
        }
        Update: {
          block?: number
          created_at?: string
          embedding?: string
          profile?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'block_embeddings_block_fkey'
            columns: ['block']
            isOneToOne: false
            referencedRelation: 'blocks'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'block_embeddings_profile_fkey'
            columns: ['profile']
            isOneToOne: false
            referencedRelation: 'embedding_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      block_lexical_records: {
        Row: {
          block: number
          created_at: string
          label: string
          search_vector: unknown
          text: string | null
          updated_at: string
        }
        Insert: {
          block: number
          created_at?: string
          label: string
          search_vector: unknown
          text?: string | null
          updated_at?: string
        }
        Update: {
          block?: number
          created_at?: string
          label?: string
          search_vector?: unknown
          text?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'block_lexical_records_block_fkey'
            columns: ['block']
            isOneToOne: true
            referencedRelation: 'blocks'
            referencedColumns: ['id']
          },
        ]
      }
      blocks: {
        Row: {
          content: string
          created_at: string | null
          id: number
          resolver: string
          storage: number | null
          updated_at: string | null
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: number
          resolver: string
          storage?: number | null
          updated_at?: string | null
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: number
          resolver?: string
          storage?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'blocks_storage_fkey'
            columns: ['storage']
            isOneToOne: false
            referencedRelation: 'storages'
            referencedColumns: ['id']
          },
        ]
      }
      configs: {
        Row: {
          created_at: string
          key: string
          schema: string
          updated_at: string
          value: Json
        }
        Insert: {
          created_at?: string
          key: string
          schema: string
          updated_at?: string
          value: Json
        }
        Update: {
          created_at?: string
          key?: string
          schema?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      crons: {
        Row: {
          created_at: string
          enabled: boolean
          id: number
          job_parameters: Json
          job_timeout_seconds: number | null
          job_type: string
          last_job: number | null
          last_scheduled_for: string | null
          schedule: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: number
          job_parameters?: Json
          job_timeout_seconds?: number | null
          job_type: string
          last_job?: number | null
          last_scheduled_for?: string | null
          schedule: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: number
          job_parameters?: Json
          job_timeout_seconds?: number | null
          job_type?: string
          last_job?: number | null
          last_scheduled_for?: string | null
          schedule?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'crons_job_type_fkey'
            columns: ['job_type']
            isOneToOne: false
            referencedRelation: 'job_types'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'crons_last_job_fkey'
            columns: ['last_job']
            isOneToOne: false
            referencedRelation: 'jobs'
            referencedColumns: ['id']
          },
        ]
      }
      embedding_profiles: {
        Row: {
          ai_model: number
          created_at: string
          dimensions: number
          id: number
          name: string | null
          updated_at: string
        }
        Insert: {
          ai_model: number
          created_at?: string
          dimensions: number
          id?: number
          name?: string | null
          updated_at?: string
        }
        Update: {
          ai_model?: number
          created_at?: string
          dimensions?: number
          id?: number
          name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'embedding_profiles_ai_model_fkey'
            columns: ['ai_model']
            isOneToOne: false
            referencedRelation: 'ai_models'
            referencedColumns: ['id']
          },
        ]
      }
      extension_peer_participations: {
        Row: {
          config_schema: Json | null
          distribution: string | null
          enabled: boolean
          name: string
          peer_id: string
          version: string
        }
        Insert: {
          config_schema?: Json | null
          distribution?: string | null
          enabled?: boolean
          name: string
          peer_id: string
          version: string
        }
        Update: {
          config_schema?: Json | null
          distribution?: string | null
          enabled?: boolean
          name?: string
          peer_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: 'extension_peer_participations_name_fkey'
            columns: ['name']
            isOneToOne: false
            referencedRelation: 'extensions'
            referencedColumns: ['name']
          },
          {
            foreignKeyName: 'extension_peer_participations_peer_id_fkey'
            columns: ['peer_id']
            isOneToOne: false
            referencedRelation: 'peers'
            referencedColumns: ['id']
          },
        ]
      }
      extensions: {
        Row: {
          config: Json
          name: string
          nickname: string | null
          state: Json
        }
        Insert: {
          config?: Json
          name: string
          nickname?: string | null
          state?: Json
        }
        Update: {
          config?: Json
          name?: string
          nickname?: string | null
          state?: Json
        }
        Relationships: []
      }
      job_types: {
        Row: {
          default_timeout_seconds: number
          description: string
          id: string
          parameters_schema: Json
        }
        Insert: {
          default_timeout_seconds: number
          description: string
          id: string
          parameters_schema?: Json
        }
        Update: {
          default_timeout_seconds?: number
          description?: string
          id?: string
          parameters_schema?: Json
        }
        Relationships: []
      }
      jobs: {
        Row: {
          abort_requested: boolean
          closed_at: string | null
          created_at: string
          id: number
          parameters: Json
          started_at: string | null
          state: Json
          status: Database['inkcre']['Enums']['jobstatus']
          submission_traceparent: string | null
          submission_tracestate: string | null
          timeout_seconds: number
          type: string
        }
        Insert: {
          abort_requested?: boolean
          closed_at?: string | null
          created_at?: string
          id?: number
          parameters?: Json
          started_at?: string | null
          state?: Json
          status?: Database['inkcre']['Enums']['jobstatus']
          submission_traceparent?: string | null
          submission_tracestate?: string | null
          timeout_seconds: number
          type: string
        }
        Update: {
          abort_requested?: boolean
          closed_at?: string | null
          created_at?: string
          id?: number
          parameters?: Json
          started_at?: string | null
          state?: Json
          status?: Database['inkcre']['Enums']['jobstatus']
          submission_traceparent?: string | null
          submission_tracestate?: string | null
          timeout_seconds?: number
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: 'jobs_type_fkey'
            columns: ['type']
            isOneToOne: false
            referencedRelation: 'job_types'
            referencedColumns: ['id']
          },
        ]
      }
      logs: {
        Row: {
          attributes: Json
          body: string
          id: number
          severity_number: number
          severity_text: string
          span_id: string | null
          timestamp: string
          trace_id: string | null
        }
        Insert: {
          attributes?: Json
          body: string
          id?: number
          severity_number: number
          severity_text: string
          span_id?: string | null
          timestamp?: string
          trace_id?: string | null
        }
        Update: {
          attributes?: Json
          body?: string
          id?: number
          severity_number?: number
          severity_text?: string
          span_id?: string | null
          timestamp?: string
          trace_id?: string | null
        }
        Relationships: []
      }
      peers: {
        Row: {
          application_version: string | null
          capabilities: Json
          config: Json
          config_schema: Json
          created_at: string
          id: string
          labels: string[]
          lease_expires_at: string | null
          name: string
          updated_at: string
        }
        Insert: {
          application_version?: string | null
          capabilities?: Json
          config?: Json
          config_schema: Json
          created_at?: string
          id: string
          labels?: string[]
          lease_expires_at?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          application_version?: string | null
          capabilities?: Json
          config?: Json
          config_schema?: Json
          created_at?: string
          id?: string
          labels?: string[]
          lease_expires_at?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      relation_embeddings: {
        Row: {
          created_at: string
          embedding: string
          profile: number
          relation: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          embedding: string
          profile: number
          relation: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          embedding?: string
          profile?: number
          relation?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'relation_embeddings_profile_fkey'
            columns: ['profile']
            isOneToOne: false
            referencedRelation: 'embedding_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'relation_embeddings_relation_fkey'
            columns: ['relation']
            isOneToOne: false
            referencedRelation: 'relations'
            referencedColumns: ['id']
          },
        ]
      }
      relations: {
        Row: {
          content: string
          from_: number | null
          id: number
          to_: number | null
          updated_at: string | null
        }
        Insert: {
          content: string
          from_?: number | null
          id?: number
          to_?: number | null
          updated_at?: string | null
        }
        Update: {
          content?: string
          from_?: number | null
          id?: number
          to_?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'relations_from__fkey'
            columns: ['from_']
            isOneToOne: false
            referencedRelation: 'blocks'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'relations_to__fkey'
            columns: ['to_']
            isOneToOne: false
            referencedRelation: 'blocks'
            referencedColumns: ['id']
          },
        ]
      }
      sink_types: {
        Row: {
          config_schema: Json
          description: string
          id: string
        }
        Insert: {
          config_schema?: Json
          description: string
          id: string
        }
        Update: {
          config_schema?: Json
          description?: string
          id?: string
        }
        Relationships: []
      }
      sinks: {
        Row: {
          config: Json
          enabled: string[]
          id: number
          nickname: string | null
          type: string
        }
        Insert: {
          config?: Json
          enabled?: string[]
          id?: number
          nickname?: string | null
          type: string
        }
        Update: {
          config?: Json
          enabled?: string[]
          id?: number
          nickname?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: 'sinks_type_fkey'
            columns: ['type']
            isOneToOne: false
            referencedRelation: 'sink_types'
            referencedColumns: ['id']
          },
        ]
      }
      sources: {
        Row: {
          block: number | null
          config: Json
          created_at: string
          id: number
          nickname: string | null
          state: Json
          storage: number | null
          type: string | null
          updated_at: string
        }
        Insert: {
          block?: number | null
          config?: Json
          created_at?: string
          id?: number
          nickname?: string | null
          state?: Json
          storage?: number | null
          type?: string | null
          updated_at?: string
        }
        Update: {
          block?: number | null
          config?: Json
          created_at?: string
          id?: number
          nickname?: string | null
          state?: Json
          storage?: number | null
          type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'sources_block_fkey'
            columns: ['block']
            isOneToOne: true
            referencedRelation: 'blocks'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sources_storage_fkey'
            columns: ['storage']
            isOneToOne: false
            referencedRelation: 'storages'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sources_type_fkey'
            columns: ['type']
            isOneToOne: false
            referencedRelation: 'sources_types'
            referencedColumns: ['id']
          },
        ]
      }
      sources_types: {
        Row: {
          backfill_config_schema: Json | null
          collect_config_schema: Json
          config_schema: Json
          description: string | null
          id: string
        }
        Insert: {
          backfill_config_schema?: Json | null
          collect_config_schema?: Json
          config_schema?: Json
          description?: string | null
          id: string
        }
        Update: {
          backfill_config_schema?: Json | null
          collect_config_schema?: Json
          config_schema?: Json
          description?: string | null
          id?: string
        }
        Relationships: []
      }
      storage_blobs: {
        Row: {
          data: string
          id: string
        }
        Insert: {
          data: string
          id?: string
        }
        Update: {
          data?: string
          id?: string
        }
        Relationships: []
      }
      storage_types: {
        Row: {
          config_schema: Json
          description: string
          id: string
          writable: boolean
        }
        Insert: {
          config_schema?: Json
          description: string
          id: string
          writable?: boolean
        }
        Update: {
          config_schema?: Json
          description?: string
          id?: string
          writable?: boolean
        }
        Relationships: []
      }
      storages: {
        Row: {
          config: Json
          id: number
          nickname: string | null
          type: string
        }
        Insert: {
          config?: Json
          id?: number
          nickname?: string | null
          type: string
        }
        Update: {
          config?: Json
          id?: number
          nickname?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: 'storages_type_fkey'
            columns: ['type']
            isOneToOne: false
            referencedRelation: 'storage_types'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      read_storage_blob: { Args: { blob_id: string }; Returns: unknown }
      renew_peer_lease: {
        Args: { peer: string; ttl_seconds: number }
        Returns: string
      }
    }
    Enums: {
      jobstatus: 'pending' | 'running' | 'finished' | 'failed' | 'timed_out' | 'aborted'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  inkcre: {
    Enums: {
      jobstatus: ['pending', 'running', 'finished', 'failed', 'timed_out', 'aborted'],
    },
  },
} as const
