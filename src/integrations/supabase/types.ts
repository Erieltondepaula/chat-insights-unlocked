export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agendamentos: {
        Row: {
          convenio: string
          criado_em: string
          criado_por: string | null
          data_hora: string
          demanda_id: string | null
          id: string
          origem: Database["public"]["Enums"]["resolvedor_tipo"]
          paciente_nome: string | null
          paciente_telefone: string
          procedimento_id: string
          profissional_id: string
          status: string
          unidade: string
        }
        Insert: {
          convenio: string
          criado_em?: string
          criado_por?: string | null
          data_hora: string
          demanda_id?: string | null
          id?: string
          origem?: Database["public"]["Enums"]["resolvedor_tipo"]
          paciente_nome?: string | null
          paciente_telefone: string
          procedimento_id: string
          profissional_id: string
          status?: string
          unidade: string
        }
        Update: {
          convenio?: string
          criado_em?: string
          criado_por?: string | null
          data_hora?: string
          demanda_id?: string | null
          id?: string
          origem?: Database["public"]["Enums"]["resolvedor_tipo"]
          paciente_nome?: string | null
          paciente_telefone?: string
          procedimento_id?: string
          profissional_id?: string
          status?: string
          unidade?: string
        }
        Relationships: [
          {
            foreignKeyName: "agendamentos_procedimento_id_fkey"
            columns: ["procedimento_id"]
            isOneToOne: false
            referencedRelation: "procedimentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agendamentos_profissional_id_fkey"
            columns: ["profissional_id"]
            isOneToOne: false
            referencedRelation: "profissionais_regras"
            referencedColumns: ["id"]
          },
        ]
      }
      demandas_auditoria: {
        Row: {
          agendamento_id: string | null
          canal: Database["public"]["Enums"]["canal_origem"]
          data_abertura: string
          data_fechamento: string | null
          id: string
          intencao_detectada: string | null
          log_solucao: string | null
          mensagem_original: string
          motivo_bloqueio: string | null
          payload_intencao: Json | null
          resolvido_por_id: string | null
          resolvido_por_nome: string | null
          resolvido_por_tipo:
            | Database["public"]["Enums"]["resolvedor_tipo"]
            | null
          solicitante_id: string
          solicitante_nome: string | null
          status: Database["public"]["Enums"]["status_demanda"]
        }
        Insert: {
          agendamento_id?: string | null
          canal?: Database["public"]["Enums"]["canal_origem"]
          data_abertura?: string
          data_fechamento?: string | null
          id?: string
          intencao_detectada?: string | null
          log_solucao?: string | null
          mensagem_original: string
          motivo_bloqueio?: string | null
          payload_intencao?: Json | null
          resolvido_por_id?: string | null
          resolvido_por_nome?: string | null
          resolvido_por_tipo?:
            | Database["public"]["Enums"]["resolvedor_tipo"]
            | null
          solicitante_id: string
          solicitante_nome?: string | null
          status?: Database["public"]["Enums"]["status_demanda"]
        }
        Update: {
          agendamento_id?: string | null
          canal?: Database["public"]["Enums"]["canal_origem"]
          data_abertura?: string
          data_fechamento?: string | null
          id?: string
          intencao_detectada?: string | null
          log_solucao?: string | null
          mensagem_original?: string
          motivo_bloqueio?: string | null
          payload_intencao?: Json | null
          resolvido_por_id?: string | null
          resolvido_por_nome?: string | null
          resolvido_por_tipo?:
            | Database["public"]["Enums"]["resolvedor_tipo"]
            | null
          solicitante_id?: string
          solicitante_nome?: string | null
          status?: Database["public"]["Enums"]["status_demanda"]
        }
        Relationships: [
          {
            foreignKeyName: "demandas_auditoria_agendamento_id_fkey"
            columns: ["agendamento_id"]
            isOneToOne: false
            referencedRelation: "agendamentos"
            referencedColumns: ["id"]
          },
        ]
      }
      procedimentos: {
        Row: {
          ativo: boolean
          codigo: string
          criado_em: string
          duracao_minutos: number
          exige_guia: boolean
          id: string
          nome: string
          preparo: string | null
          sinonimos: Json
        }
        Insert: {
          ativo?: boolean
          codigo: string
          criado_em?: string
          duracao_minutos?: number
          exige_guia?: boolean
          id?: string
          nome: string
          preparo?: string | null
          sinonimos?: Json
        }
        Update: {
          ativo?: boolean
          codigo?: string
          criado_em?: string
          duracao_minutos?: number
          exige_guia?: boolean
          id?: string
          nome?: string
          preparo?: string | null
          sinonimos?: Json
        }
        Relationships: []
      }
      profissionais_regras: {
        Row: {
          ativo: boolean
          atualizado_em: string
          conselho: string | null
          convenios: Json
          criado_em: string
          id: string
          idade_max: number
          idade_min: number
          nome: string
          unidades_ativas: Json
        }
        Insert: {
          ativo?: boolean
          atualizado_em?: string
          conselho?: string | null
          convenios?: Json
          criado_em?: string
          id?: string
          idade_max?: number
          idade_min?: number
          nome: string
          unidades_ativas?: Json
        }
        Update: {
          ativo?: boolean
          atualizado_em?: string
          conselho?: string | null
          convenios?: Json
          criado_em?: string
          id?: string
          idade_max?: number
          idade_min?: number
          nome?: string
          unidades_ativas?: Json
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "auditor" | "operador"
      canal_origem: "whatsapp" | "web" | "telefone"
      resolvedor_tipo: "agente_flow" | "atendente_humano"
      status_demanda: "pendente" | "em_atendimento" | "resolvido" | "cancelado"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "auditor", "operador"],
      canal_origem: ["whatsapp", "web", "telefone"],
      resolvedor_tipo: ["agente_flow", "atendente_humano"],
      status_demanda: ["pendente", "em_atendimento", "resolvido", "cancelado"],
    },
  },
} as const
