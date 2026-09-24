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
      accounts: {
        Row: {
          active: boolean
          color: string
          created_at: string
          current_balance: number
          id: string
          initial_balance: number
          institution: string
          name: string
          type: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          active?: boolean
          color?: string
          created_at?: string
          current_balance?: number
          id?: string
          initial_balance?: number
          institution?: string
          name: string
          type: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          active?: boolean
          color?: string
          created_at?: string
          current_balance?: number
          id?: string
          initial_balance?: number
          institution?: string
          name?: string
          type?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      budgets: {
        Row: {
          category_id: string
          created_at: string
          id: string
          month: number
          planned_amount: number
          workspace_id: string
          year: number
        }
        Insert: {
          category_id: string
          created_at?: string
          id?: string
          month: number
          planned_amount: number
          workspace_id: string
          year: number
        }
        Update: {
          category_id?: string
          created_at?: string
          id?: string
          month?: number
          planned_amount?: number
          workspace_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "budgets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          active: boolean
          color: string
          created_at: string
          icon: string
          id: string
          name: string
          parent_id: string | null
          type: string
          workspace_id: string
        }
        Insert: {
          active?: boolean
          color?: string
          created_at?: string
          icon?: string
          id?: string
          name: string
          parent_id?: string | null
          type: string
          workspace_id: string
        }
        Update: {
          active?: boolean
          color?: string
          created_at?: string
          icon?: string
          id?: string
          name?: string
          parent_id?: string | null
          type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_card_bills: {
        Row: {
          closing_date: string
          created_at: string
          credit_card_id: string
          due_date: string
          id: string
          paid_amount: number
          paid_at: string | null
          reference_month: string
          status: string
          total_amount: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          closing_date: string
          created_at?: string
          credit_card_id: string
          due_date: string
          id?: string
          paid_amount?: number
          paid_at?: string | null
          reference_month: string
          status?: string
          total_amount?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          closing_date?: string
          created_at?: string
          credit_card_id?: string
          due_date?: string
          id?: string
          paid_amount?: number
          paid_at?: string | null
          reference_month?: string
          status?: string
          total_amount?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_card_bills_credit_card_id_fkey"
            columns: ["credit_card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_card_bills_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_cards: {
        Row: {
          active: boolean
          closing_day: number
          color: string
          created_at: string
          credit_limit: number
          due_day: number
          id: string
          institution: string
          last_four_digits: string | null
          linked_payment_account_id: string | null
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          active?: boolean
          closing_day: number
          color?: string
          created_at?: string
          credit_limit?: number
          due_day: number
          id?: string
          institution?: string
          last_four_digits?: string | null
          linked_payment_account_id?: string | null
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          active?: boolean
          closing_day?: number
          color?: string
          created_at?: string
          credit_limit?: number
          due_day?: number
          id?: string
          institution?: string
          last_four_digits?: string | null
          linked_payment_account_id?: string | null
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_cards_linked_payment_account_id_fkey"
            columns: ["linked_payment_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_cards_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_goals: {
        Row: {
          color: string
          created_at: string
          current_amount: number
          icon: string
          id: string
          name: string
          status: string
          target_amount: number
          target_date: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          current_amount?: number
          icon?: string
          id?: string
          name: string
          status?: string
          target_amount: number
          target_date?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          color?: string
          created_at?: string
          current_amount?: number
          icon?: string
          id?: string
          name?: string
          status?: string
          target_amount?: number
          target_date?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_goals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      installments: {
        Row: {
          amount: number
          created_at: string
          credit_card_bill_id: string | null
          due_date: string
          id: string
          installment_number: number
          paid_amount: number
          paid_at: string | null
          purchase_id: string
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          credit_card_bill_id?: string | null
          due_date: string
          id?: string
          installment_number: number
          paid_amount?: number
          paid_at?: string | null
          purchase_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          credit_card_bill_id?: string | null
          due_date?: string
          id?: string
          installment_number?: number
          paid_amount?: number
          paid_at?: string | null
          purchase_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "installments_credit_card_bill_id_fkey"
            columns: ["credit_card_bill_id"]
            isOneToOne: false
            referencedRelation: "credit_card_bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installments_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          active: boolean
          created_at: string
          credit_card_id: string | null
          id: string
          linked_account_id: string | null
          name: string
          type: string
          workspace_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          credit_card_id?: string | null
          id?: string
          linked_account_id?: string | null
          name: string
          type: string
          workspace_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          credit_card_id?: string | null
          id?: string
          linked_account_id?: string | null
          name?: string
          type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_methods_credit_card_id_fkey"
            columns: ["credit_card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_methods_linked_account_id_fkey"
            columns: ["linked_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_methods_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          account_id: string | null
          affects_balance: boolean
          amount: number
          created_at: string
          created_by: string | null
          credit_card_bill_id: string | null
          id: string
          installment_id: string | null
          notes: string | null
          payment_date: string
          payment_method_id: string | null
          transaction_id: string | null
          workspace_id: string
        }
        Insert: {
          account_id?: string | null
          affects_balance?: boolean
          amount: number
          created_at?: string
          created_by?: string | null
          credit_card_bill_id?: string | null
          id?: string
          installment_id?: string | null
          notes?: string | null
          payment_date?: string
          payment_method_id?: string | null
          transaction_id?: string | null
          workspace_id: string
        }
        Update: {
          account_id?: string | null
          affects_balance?: boolean
          amount?: number
          created_at?: string
          created_by?: string | null
          credit_card_bill_id?: string | null
          id?: string
          installment_id?: string | null
          notes?: string | null
          payment_date?: string
          payment_method_id?: string | null
          transaction_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_credit_card_bill_id_fkey"
            columns: ["credit_card_bill_id"]
            isOneToOne: false
            referencedRelation: "credit_card_bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_installment_id_fkey"
            columns: ["installment_id"]
            isOneToOne: false
            referencedRelation: "installments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          id: string
          name: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      purchase_splits: {
        Row: {
          amount: number
          created_at: string
          id: string
          member_id: string
          percentage: number | null
          purchase_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          member_id: string
          percentage?: number | null
          purchase_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          member_id?: string
          percentage?: number | null
          purchase_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_splits_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_splits_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_splits_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases: {
        Row: {
          account_id: string | null
          category_id: string | null
          created_at: string
          created_by: string | null
          credit_card_id: string | null
          description: string
          id: string
          installment_count: number
          paid_by_member_id: string | null
          paid_installments_count: number | null
          payment_method_id: string | null
          purchase_date: string
          split_type: string
          total_amount: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          account_id?: string | null
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          credit_card_id?: string | null
          description: string
          id?: string
          installment_count: number
          paid_by_member_id?: string | null
          paid_installments_count?: number | null
          payment_method_id?: string | null
          purchase_date?: string
          split_type?: string
          total_amount: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          account_id?: string | null
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          credit_card_id?: string | null
          description?: string
          id?: string
          installment_count?: number
          paid_by_member_id?: string | null
          paid_installments_count?: number | null
          payment_method_id?: string | null
          purchase_date?: string
          split_type?: string
          total_amount?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchases_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_credit_card_id_fkey"
            columns: ["credit_card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_paid_by_member_id_fkey"
            columns: ["paid_by_member_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_transactions: {
        Row: {
          account_id: string | null
          active: boolean
          amount: number
          auto_create: boolean
          category_id: string | null
          created_at: string
          credit_card_id: string | null
          description: string
          end_date: string | null
          frequency: string
          id: string
          interval_days: number | null
          next_occurrence: string
          payment_method_id: string | null
          start_date: string
          suspended_reason: string | null
          type: string
          workspace_id: string
        }
        Insert: {
          account_id?: string | null
          active?: boolean
          amount: number
          auto_create?: boolean
          category_id?: string | null
          created_at?: string
          credit_card_id?: string | null
          description: string
          end_date?: string | null
          frequency: string
          id?: string
          interval_days?: number | null
          next_occurrence: string
          payment_method_id?: string | null
          start_date: string
          suspended_reason?: string | null
          type: string
          workspace_id: string
        }
        Update: {
          account_id?: string | null
          active?: boolean
          amount?: number
          auto_create?: boolean
          category_id?: string | null
          created_at?: string
          credit_card_id?: string | null
          description?: string
          end_date?: string | null
          frequency?: string
          id?: string
          interval_days?: number | null
          next_occurrence?: string
          payment_method_id?: string | null
          start_date?: string
          suspended_reason?: string | null
          type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_transactions_credit_card_id_fkey"
            columns: ["credit_card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_transactions_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_transactions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      settlements: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          from_member_id: string
          id: string
          notes: string | null
          payment_account_id: string | null
          settlement_date: string
          to_member_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          from_member_id: string
          id?: string
          notes?: string | null
          payment_account_id?: string | null
          settlement_date?: string
          to_member_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          from_member_id?: string
          id?: string
          notes?: string | null
          payment_account_id?: string | null
          settlement_date?: string
          to_member_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_from_member_id_fkey"
            columns: ["from_member_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_payment_account_id_fkey"
            columns: ["payment_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_to_member_id_fkey"
            columns: ["to_member_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_splits: {
        Row: {
          amount: number
          created_at: string
          id: string
          member_id: string
          percentage: number | null
          transaction_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          member_id: string
          percentage?: number | null
          transaction_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          member_id?: string
          percentage?: number | null
          transaction_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_splits_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_splits_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_splits_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          account_id: string | null
          amount: number
          category_id: string | null
          created_at: string
          created_by: string | null
          credit_card_bill_id: string | null
          credit_card_id: string | null
          description: string
          due_date: string
          id: string
          notes: string | null
          paid_at: string | null
          paid_by_member_id: string | null
          payment_method_id: string | null
          recurring_transaction_id: string | null
          split_type: string
          status: string
          transaction_date: string
          type: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          account_id?: string | null
          amount: number
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          credit_card_bill_id?: string | null
          credit_card_id?: string | null
          description: string
          due_date?: string
          id?: string
          notes?: string | null
          paid_at?: string | null
          paid_by_member_id?: string | null
          payment_method_id?: string | null
          recurring_transaction_id?: string | null
          split_type?: string
          status?: string
          transaction_date?: string
          type: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          account_id?: string | null
          amount?: number
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          credit_card_bill_id?: string | null
          credit_card_id?: string | null
          description?: string
          due_date?: string
          id?: string
          notes?: string | null
          paid_at?: string | null
          paid_by_member_id?: string | null
          payment_method_id?: string | null
          recurring_transaction_id?: string | null
          split_type?: string
          status?: string
          transaction_date?: string
          type?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_credit_card_bill_id_fkey"
            columns: ["credit_card_bill_id"]
            isOneToOne: false
            referencedRelation: "credit_card_bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_credit_card_id_fkey"
            columns: ["credit_card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_paid_by_member_id_fkey"
            columns: ["paid_by_member_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_recurring_transaction_id_fkey"
            columns: ["recurring_transaction_id"]
            isOneToOne: false
            referencedRelation: "recurring_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      transfers: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          from_account_id: string
          id: string
          idempotency_key: string | null
          notes: string | null
          to_account_id: string
          transfer_date: string
          workspace_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          from_account_id: string
          id?: string
          idempotency_key?: string | null
          notes?: string | null
          to_account_id: string
          transfer_date?: string
          workspace_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          from_account_id?: string
          id?: string
          idempotency_key?: string | null
          notes?: string | null
          to_account_id?: string
          transfer_date?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transfers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfers_from_account_id_fkey"
            columns: ["from_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfers_to_account_id_fkey"
            columns: ["to_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          id: string
          role: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          currency: string
          id: string
          name: string
          owner_id: string
          tracking_mode: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          name: string
          owner_id: string
          tracking_mode?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          name?: string
          owner_id?: string
          tracking_mode?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      fn_create_credit_card_transaction: {
        Args: {
          p_amount: number
          p_category_id?: string
          p_credit_card_id: string
          p_description: string
          p_paid_by_member_id?: string
          p_payment_method_id?: string
          p_split_type?: string
          p_transaction_date?: string
          p_workspace_id: string
        }
        Returns: string
      }
      fn_create_installment_purchase: {
        Args: {
          p_account_id?: string
          p_category_id?: string
          p_credit_card_id?: string
          p_description: string
          p_installment_count: number
          p_paid_by_member_id?: string
          p_paid_installments_count?: number
          p_payment_method_id?: string
          p_purchase_date?: string
          p_split_type?: string
          p_total_amount: number
          p_workspace_id: string
        }
        Returns: string
      }
      fn_create_transfer: {
        Args: {
          p_amount: number
          p_from_account_id: string
          p_idempotency_key?: string
          p_notes?: string
          p_to_account_id: string
          p_transfer_date?: string
          p_workspace_id: string
        }
        Returns: string
      }
      fn_create_workspace:
        | { Args: { p_currency?: string; p_name: string }; Returns: string }
        | {
            Args: {
              p_currency?: string
              p_name: string
              p_tracking_mode?: string
            }
            Returns: string
          }
      fn_get_or_create_credit_card_bill:
        | { Args: { p_card_id: string; p_date: string }; Returns: string }
        | {
            Args: {
              p_credit_card_id: string
              p_reference_month: string
              p_workspace_id: string
            }
            Returns: string
          }
      fn_record_payment: {
        Args: {
          p_account_id: string
          p_affects_balance?: boolean
          p_amount: number
          p_credit_card_bill_id?: string
          p_installment_id?: string
          p_notes?: string
          p_payment_date?: string
          p_payment_method_id?: string
          p_transaction_id?: string
          p_workspace_id: string
        }
        Returns: string
      }
      fn_record_settlement: {
        Args: {
          p_amount: number
          p_from_member_id: string
          p_notes?: string
          p_payment_account_id?: string
          p_settlement_date?: string
          p_to_member_id: string
          p_workspace_id: string
        }
        Returns: string
      }
      fn_set_purchase_splits: {
        Args: { p_purchase_id: string; p_splits: Json; p_workspace_id: string }
        Returns: number
      }
      fn_set_transaction_splits: {
        Args: {
          p_splits: Json
          p_transaction_id: string
          p_workspace_id: string
        }
        Returns: number
      }
      fn_transfer_workspace_ownership: {
        Args: { p_new_owner_id: string; p_workspace_id: string }
        Returns: undefined
      }
      has_workspace_role: {
        Args: { p_roles: string[]; p_workspace_id: string }
        Returns: boolean
      }
      is_member: { Args: { p_workspace_id: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
