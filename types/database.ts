export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      // 1. CLIENTES (Tabela Principal)
      cliente: {
        Row: {
          id: string // uuid
          tenant_id: string // uuid
          name: string
          
          // 🚨 ATENÇÃO: Use ESTES nomes, não invente outros
          primary_whatsapp_e164: string | null // O WhatsApp real
          whatsapp_username: string | null
          whatsapp_opt_in: boolean
          
          server_id: string | null // Link com o servidor
          server_username: string | null
          server_password_encrypted: string | null
          
          expires_at: string | null // Data de Vencimento (timestamptz)
          is_archived: boolean // Se true, não renova
          
          price_amount: number | null // numeric
          price_currency: string // 'BRL', etc
          
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['cliente']['Row']>
        Update: Partial<Database['public']['Tables']['cliente']['Row']>
      }

      tenant_members: {
        Row: {
          id: string
          tenant_id: string
          user_id: string
          created_at: string
        }}

      // 2. SERVIDORES (Estoque)
      servers: {
        Row: {
          id: string
          tenant_id: string
          name: string
          slug: string
          
          // 🚨 SALDO REAL:
          credits_available: number // numeric (Não edite isso manualmente no front)
          default_credit_unit_price: number // numeric
          
          panel_web_url: string | null
          is_archived: boolean
          created_at: string
        }
      }

      // 3. VENDAS (Renovações manuais ou Vendas avulsas)
      server_credit_venda: {
        Row: {
          id: string
          server_id: string
          tenant_id: string
          credits_qty: number
          total_received: number // Valor Financeiro (Caixa)
          price_per_credit: number
          notes: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['server_credit_venda']['Row'], 'id' | 'created_at'>
      }

      // 4. COMPRAS (Entrada de Créditos no Estoque)
      server_credit_purchases: {
        Row: {
          id: string
          server_id: string
          credits_qty: number
          total_paid_brl: number
          notes: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['server_credit_purchases']['Row'], 'id' | 'created_at'>
      }

      // 5. CONSUMO TÉCNICO (Log de uso diário/mensal)
      server_credit_usage: {
        Row: {
          id: string
          client_id: string
          server_id: string
          credits_used: number
          notes: string | null
          created_at: string
        }
      }
    }

    Views: {
      // 6. VIEW FINANCEIRA (Para os Gráficos)
      vw_server_movements: {
        Row: {
          happened_at: string // Data para o Eixo X
          kind: 'PURCHASE' | 'DIRECT_SALE' | 'RESELLER_SALE'
          qty_credits: number
          total_brl: number // Valor Financeiro
          unit_price: number
          label: string | null
        }
      }
    }

    Functions: {
      // 7. A FUNÇÃO MÁGICA DE RENOVAÇÃO (Use via rpc)
      renew_client_and_log: {
        Args: {
          p_tenant_id: string
          p_client_id: string
          p_months: number // 1, 2, 3, 6, 12
          p_status: string // ex: 'paid'
          p_notes: string
        }
        Returns: {
          new_expires_at: string
          credits_used: number
          server_balance_after: number
        }[]
 
      }
 
    }
  }
}