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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      _db_managed_objects: {
        Row: {
          created_at: string
          object_identity: string
          object_type: string
        }
        Insert: {
          created_at?: string
          object_identity: string
          object_type: string
        }
        Update: {
          created_at?: string
          object_identity?: string
          object_type?: string
        }
        Relationships: []
      }
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
      financial_operations: {
        Row: {
          created_at: string
          created_by: string | null
          operation_key: string
          operation_kind: string
          payload: Json
          result_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          operation_key: string
          operation_kind: string
          payload: Json
          result_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          operation_key?: string
          operation_kind?: string
          payload?: Json
          result_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_operations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_deposits: {
        Row: {
          account_id: string
          amount: number
          created_at: string
          created_by: string
          goal_id: string
          id: string
          idempotency_key: string
          reversed_at: string | null
          workspace_id: string
        }
        Insert: {
          account_id: string
          amount: number
          created_at?: string
          created_by: string
          goal_id: string
          id?: string
          idempotency_key: string
          reversed_at?: string | null
          workspace_id: string
        }
        Update: {
          account_id?: string
          amount?: number
          created_at?: string
          created_by?: string
          goal_id?: string
          id?: string
          idempotency_key?: string
          reversed_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goal_deposits_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_deposits_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "financial_goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_deposits_workspace_id_fkey"
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
          operation_key: string | null
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
          operation_key?: string | null
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
          operation_key?: string | null
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
      people: {
        Row: {
          archived: boolean
          created_at: string
          id: string
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "people_workspace_id_fkey"
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
          member_id: string | null
          percentage: number | null
          person_id: string | null
          purchase_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          member_id?: string | null
          percentage?: number | null
          person_id?: string | null
          purchase_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          member_id?: string | null
          percentage?: number | null
          person_id?: string | null
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
            foreignKeyName: "purchase_splits_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
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
          operation_key: string | null
          paid_by_member_id: string | null
          paid_by_person_id: string | null
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
          operation_key?: string | null
          paid_by_member_id?: string | null
          paid_by_person_id?: string | null
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
          operation_key?: string | null
          paid_by_member_id?: string | null
          paid_by_person_id?: string | null
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
            foreignKeyName: "purchases_paid_by_person_id_fkey"
            columns: ["paid_by_person_id"]
            isOneToOne: false
            referencedRelation: "people"
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
          updated_at: string
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
          updated_at?: string
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
          updated_at?: string
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
          from_member_id: string | null
          from_person_id: string | null
          id: string
          notes: string | null
          operation_key: string | null
          payment_account_id: string | null
          settlement_date: string
          to_member_id: string | null
          to_person_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          from_member_id?: string | null
          from_person_id?: string | null
          id?: string
          notes?: string | null
          operation_key?: string | null
          payment_account_id?: string | null
          settlement_date?: string
          to_member_id?: string | null
          to_person_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          from_member_id?: string | null
          from_person_id?: string | null
          id?: string
          notes?: string | null
          operation_key?: string | null
          payment_account_id?: string | null
          settlement_date?: string
          to_member_id?: string | null
          to_person_id?: string | null
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
            foreignKeyName: "settlements_from_person_id_fkey"
            columns: ["from_person_id"]
            isOneToOne: false
            referencedRelation: "people"
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
            foreignKeyName: "settlements_to_person_id_fkey"
            columns: ["to_person_id"]
            isOneToOne: false
            referencedRelation: "people"
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
          member_id: string | null
          percentage: number | null
          person_id: string | null
          transaction_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          member_id?: string | null
          percentage?: number | null
          person_id?: string | null
          transaction_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          member_id?: string | null
          percentage?: number | null
          person_id?: string | null
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
            foreignKeyName: "transaction_splits_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
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
          operation_key: string | null
          paid_at: string | null
          paid_by_member_id: string | null
          paid_by_person_id: string | null
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
          operation_key?: string | null
          paid_at?: string | null
          paid_by_member_id?: string | null
          paid_by_person_id?: string | null
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
          operation_key?: string | null
          paid_at?: string | null
          paid_by_member_id?: string | null
          paid_by_person_id?: string | null
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
            foreignKeyName: "transactions_paid_by_person_id_fkey"
            columns: ["paid_by_person_id"]
            isOneToOne: false
            referencedRelation: "people"
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
          operation_key: string | null
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
          operation_key?: string | null
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
          operation_key?: string | null
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
      fn_add_workspace_member: {
        Args: {
          p_email_or_user_id: string
          p_role?: string
          p_workspace_id: string
        }
        Returns: string
      }
      fn_check_routine_privilege: {
        Args: { p_privilege?: string; p_routine: string }
        Returns: boolean
      }
      fn_check_table_privilege: {
        Args: { p_privilege: string; p_table: string }
        Returns: boolean
      }
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
          p_paid_by_person_id?: string
          p_paid_installments_count?: number
          p_payment_method_id?: string
          p_purchase_date?: string
          p_split_type?: string
          p_total_amount: number
          p_workspace_id: string
        }
        Returns: string
      }
      fn_create_purchase_with_splits: {
        Args: {
          p_account_id?: string
          p_category_id?: string
          p_credit_card_id?: string
          p_description: string
          p_installment_count: number
          p_paid_by_member_id?: string
          p_paid_by_person_id?: string
          p_paid_installments_count?: number
          p_payment_method_id?: string
          p_purchase_date?: string
          p_split_type?: string
          p_splits?: Json
          p_total_amount: number
          p_workspace_id: string
        }
        Returns: string
      }
      fn_create_transaction_with_splits: {
        Args: {
          p_account_id?: string
          p_amount: number
          p_category_id?: string
          p_credit_card_bill_id?: string
          p_credit_card_id?: string
          p_description: string
          p_due_date?: string
          p_notes?: string
          p_paid_by_member_id?: string
          p_paid_by_person_id?: string
          p_payment_method_id?: string
          p_split_type?: string
          p_splits?: Json
          p_status?: string
          p_transaction_date?: string
          p_type?: string
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
      fn_create_workspace: {
        Args: { p_currency?: string; p_name: string; p_tracking_mode?: string }
        Returns: string
      }
      fn_delete_payment: {
        Args: { p_payment_id: string; p_workspace_id: string }
        Returns: boolean
      }
      fn_delete_purchase: {
        Args: { p_purchase_id: string; p_workspace_id: string }
        Returns: boolean
      }
      fn_delete_settlement: {
        Args: { p_settlement_id: string; p_workspace_id?: string }
        Returns: boolean
      }
      fn_delete_transaction: {
        Args: { p_transaction_id: string; p_workspace_id: string }
        Returns: boolean
      }
      fn_delete_transfer: {
        Args: { p_transfer_id: string; p_workspace_id: string }
        Returns: boolean
      }
      fn_execute_financial_operation: {
        Args: {
          p_operation_key: string
          p_operation_kind: string
          p_payload: Json
          p_workspace_id: string
        }
        Returns: string
      }
      fn_get_or_create_credit_card_bill: {
        Args: {
          p_credit_card_id: string
          p_reference_month: string
          p_workspace_id: string
        }
        Returns: string
      }
      fn_materialize_recurring_transactions: {
        Args: { p_target_date?: string; p_workspace_id?: string }
        Returns: Json
      }
      fn_normalize_money: {
        Args: { p_rule?: string; p_value: number }
        Returns: number
      }
      fn_record_goal_deposit: {
        Args: {
          p_account_id: string
          p_amount: number
          p_goal_id: string
          p_idempotency_key: string
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
          p_amount?: number
          p_from_member_id?: string
          p_from_person_id?: string
          p_notes?: string
          p_payment_account_id?: string
          p_settlement_date?: string
          p_to_member_id?: string
          p_to_person_id?: string
          p_workspace_id: string
        }
        Returns: string
      }
      fn_reverse_goal_deposit: {
        Args: { p_deposit_id: string; p_workspace_id: string }
        Returns: undefined
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
      fn_step_next_occurrence: {
        Args: {
          p_curr_date: string
          p_frequency: string
          p_interval_days?: number
          p_start_date: string
        }
        Returns: string
      }
      fn_transfer_workspace_ownership: {
        Args: { p_new_owner_id: string; p_workspace_id: string }
        Returns: undefined
      }
      fn_update_payment: {
        Args: {
          p_account_id?: string
          p_affects_balance?: boolean
          p_amount?: number
          p_notes?: string
          p_payment_date?: string
          p_payment_id: string
          p_payment_method_id?: string
          p_workspace_id: string
        }
        Returns: string
      }
      fn_update_purchase_with_splits: {
        Args: {
          p_account_id?: string
          p_category_id?: string
          p_credit_card_id?: string
          p_description?: string
          p_paid_by_member_id?: string
          p_paid_by_person_id?: string
          p_payment_method_id?: string
          p_purchase_date?: string
          p_purchase_id: string
          p_split_type?: string
          p_splits?: Json
          p_total_amount?: number
          p_workspace_id: string
        }
        Returns: string
      }
      fn_update_transaction_with_splits: {
        Args: {
          p_account_id?: string
          p_amount?: number
          p_category_id?: string
          p_credit_card_bill_id?: string
          p_credit_card_id?: string
          p_description?: string
          p_due_date?: string
          p_notes?: string
          p_paid_by_member_id?: string
          p_paid_by_person_id?: string
          p_payment_method_id?: string
          p_split_type?: string
          p_splits?: Json
          p_transaction_date?: string
          p_transaction_id: string
          p_type?: string
          p_workspace_id: string
        }
        Returns: string
      }
      fn_update_transfer: {
        Args: {
          p_amount?: number
          p_from_account_id?: string
          p_notes?: string
          p_to_account_id?: string
          p_transfer_date?: string
          p_transfer_id: string
          p_workspace_id: string
        }
        Returns: string
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
  storage: {
    Tables: {
      buckets: {
        Row: {
          allowed_mime_types: string[] | null
          avif_autodetection: boolean | null
          created_at: string | null
          file_size_limit: number | null
          id: string
          lifecycle_configuration: Json | null
          lifecycle_configuration_generation: string | null
          name: string
          owner: string | null
          owner_id: string | null
          public: boolean | null
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string | null
          versioning_status: string
        }
        Insert: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id: string
          lifecycle_configuration?: Json | null
          lifecycle_configuration_generation?: string | null
          name: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
          versioning_status?: string
        }
        Update: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id?: string
          lifecycle_configuration?: Json | null
          lifecycle_configuration_generation?: string | null
          name?: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
          versioning_status?: string
        }
        Relationships: []
      }
      buckets_analytics: {
        Row: {
          created_at: string
          deleted_at: string | null
          format: string
          id: string
          name: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      buckets_vectors: {
        Row: {
          created_at: string
          id: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      migrations: {
        Row: {
          executed_at: string | null
          hash: string
          id: number
          name: string
        }
        Insert: {
          executed_at?: string | null
          hash: string
          id: number
          name: string
        }
        Update: {
          executed_at?: string | null
          hash?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          archived_at: string | null
          bucket_id: string | null
          created_at: string | null
          id: string
          is_delete_marker: boolean
          is_versioned: boolean
          last_accessed_at: string | null
          metadata: Json | null
          name: string | null
          owner: string | null
          owner_id: string | null
          path_tokens: string[] | null
          updated_at: string | null
          user_metadata: Json | null
          version: string | null
        }
        Insert: {
          archived_at?: string | null
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          is_delete_marker?: boolean
          is_versioned?: boolean
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Update: {
          archived_at?: string | null
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          is_delete_marker?: boolean
          is_versioned?: boolean
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objects_bucketId_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          in_progress_size: number
          key: string
          metadata: Json | null
          owner_id: string | null
          upload_signature: string
          user_metadata: Json | null
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          id: string
          in_progress_size?: number
          key: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature: string
          user_metadata?: Json | null
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          in_progress_size?: number
          key?: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature?: string
          user_metadata?: Json | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads_parts: {
        Row: {
          bucket_id: string
          created_at: string
          etag: string
          id: string
          key: string
          owner_id: string | null
          part_number: number
          size: number
          upload_id: string
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          etag: string
          id?: string
          key: string
          owner_id?: string | null
          part_number: number
          size?: number
          upload_id: string
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          etag?: string
          id?: string
          key?: string
          owner_id?: string | null
          part_number?: number
          size?: number
          upload_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_parts_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "s3_multipart_uploads_parts_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "s3_multipart_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      vector_indexes: {
        Row: {
          bucket_id: string
          created_at: string
          data_type: string
          dimension: number
          distance_metric: string
          id: string
          metadata_configuration: Json | null
          name: string
          updated_at: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          data_type: string
          dimension: number
          distance_metric: string
          id?: string
          metadata_configuration?: Json | null
          name: string
          updated_at?: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          data_type?: string
          dimension?: number
          distance_metric?: string
          id?: string
          metadata_configuration?: Json | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vector_indexes_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets_vectors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      allow_any_operation: {
        Args: { expected_operations: string[] }
        Returns: boolean
      }
      allow_only_operation: {
        Args: { expected_operation: string }
        Returns: boolean
      }
      can_insert_object: {
        Args: { bucketid: string; metadata: Json; name: string; owner: string }
        Returns: undefined
      }
      extension: { Args: { name: string }; Returns: string }
      filename: { Args: { name: string }; Returns: string }
      foldername: { Args: { name: string }; Returns: string[] }
      get_common_prefix: {
        Args: { p_delimiter: string; p_key: string; p_prefix: string }
        Returns: string
      }
      get_size_by_bucket: {
        Args: { delete_markers?: string; noncurrent_versions?: string }
        Returns: {
          bucket_id: string
          size: number
        }[]
      }
      list_multipart_uploads_with_delimiter: {
        Args: {
          bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_key_token?: string
          next_upload_token?: string
          prefix_param: string
          raw_prefix_param?: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
        }[]
      }
      list_objects_with_delimiter: {
        Args: {
          _bucket_id: string
          delete_markers?: string
          delimiter_param: string
          max_keys?: number
          next_token?: string
          next_token_archived_at?: string
          next_token_version?: string
          noncurrent_versions?: string
          prefix_param: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          archived_at: string
          created_at: string
          id: string
          is_delete_marker: boolean
          is_versioned: boolean
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
          version: string
        }[]
      }
      operation: { Args: never; Returns: string }
      search: {
        Args: {
          bucketname: string
          delete_markers?: string
          levels?: number
          limits?: number
          noncurrent_versions?: string
          offsets?: number
          prefix: string
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          archived_at: string
          created_at: string
          id: string
          is_delete_marker: boolean
          is_versioned: boolean
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
          version: string
        }[]
      }
      search_by_timestamp: {
        Args: {
          delete_markers?: string
          noncurrent_versions?: string
          p_bucket_id: string
          p_level: number
          p_limit: number
          p_prefix: string
          p_sort_column: string
          p_sort_column_after: string
          p_sort_order: string
          p_start_after: string
          p_start_after_version?: string
        }
        Returns: {
          archived_at: string
          created_at: string
          id: string
          is_delete_marker: boolean
          is_versioned: boolean
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
          version: string
        }[]
      }
      search_v2: {
        Args: {
          bucket_name: string
          delete_markers?: string
          levels?: number
          limits?: number
          noncurrent_versions?: string
          prefix: string
          sort_column?: string
          sort_column_after?: string
          sort_order?: string
          start_after?: string
          start_after_archived_at?: string
          start_after_is_continuation?: boolean
          start_after_version?: string
        }
        Returns: {
          archived_at: string
          created_at: string
          id: string
          is_delete_marker: boolean
          is_versioned: boolean
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
          version: string
        }[]
      }
    }
    Enums: {
      buckettype: "STANDARD" | "ANALYTICS" | "VECTOR"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
  storage: {
    Enums: {
      buckettype: ["STANDARD", "ANALYTICS", "VECTOR"],
    },
  },
} as const
