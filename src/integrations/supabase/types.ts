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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      agent_memory: {
        Row: {
          content: string
          created_at: string | null
          id: string
          is_active: boolean
          kind: string
          source_correction_id: string | null
          source_pitch_id: string | null
          weight: number
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          is_active?: boolean
          kind: string
          source_correction_id?: string | null
          source_pitch_id?: string | null
          weight?: number
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          source_correction_id?: string | null
          source_pitch_id?: string | null
          weight?: number
        }
        Relationships: []
      }
      investment_thesis: {
        Row: {
          created_at: string | null
          criteria: Json
          eval_criteria_markdown: string | null
          id: string
          is_active: boolean
          notes: string | null
          thesis_markdown: string
          title: string
          updated_at: string | null
          updated_by: string | null
          version: number
        }
        Insert: {
          created_at?: string | null
          criteria?: Json
          eval_criteria_markdown?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          thesis_markdown: string
          title?: string
          updated_at?: string | null
          updated_by?: string | null
          version?: number
        }
        Update: {
          created_at?: string | null
          criteria?: Json
          eval_criteria_markdown?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          thesis_markdown?: string
          title?: string
          updated_at?: string | null
          updated_by?: string | null
          version?: number
        }
        Relationships: []
      }
      pitch_corrections: {
        Row: {
          corrected_verdict: Database["public"]["Enums"]["pitch_verdict"]
          created_at: string | null
          created_by: string | null
          criteria_updates: Json | null
          debrief: string
          id: string
          pitch_id: string
          previous_verdict: Database["public"]["Enums"]["pitch_verdict"]
          review_id: string | null
        }
        Insert: {
          corrected_verdict: Database["public"]["Enums"]["pitch_verdict"]
          created_at?: string | null
          created_by?: string | null
          criteria_updates?: Json | null
          debrief: string
          id?: string
          pitch_id: string
          previous_verdict: Database["public"]["Enums"]["pitch_verdict"]
          review_id?: string | null
        }
        Update: {
          corrected_verdict?: Database["public"]["Enums"]["pitch_verdict"]
          created_at?: string | null
          created_by?: string | null
          criteria_updates?: Json | null
          debrief?: string
          id?: string
          pitch_id?: string
          previous_verdict?: Database["public"]["Enums"]["pitch_verdict"]
          review_id?: string | null
        }
        Relationships: []
      }
      pitch_reviews: {
        Row: {
          agent_trace: Json
          bear_case: string | null
          bull_case: string | null
          claim_checks: Json
          comps: Json
          confidence: number | null
          created_at: string | null
          founder_feedback: string
          id: string
          internal_memo: string
          model_used: string | null
          pitch_id: string
          red_flags: Json
          scores: Json
          thesis_fit_summary: string | null
          thesis_id: string | null
          verdict: Database["public"]["Enums"]["pitch_verdict"]
        }
        Insert: {
          agent_trace?: Json
          bear_case?: string | null
          bull_case?: string | null
          claim_checks?: Json
          comps?: Json
          confidence?: number | null
          created_at?: string | null
          founder_feedback: string
          id?: string
          internal_memo: string
          model_used?: string | null
          pitch_id: string
          red_flags?: Json
          scores?: Json
          thesis_fit_summary?: string | null
          thesis_id?: string | null
          verdict: Database["public"]["Enums"]["pitch_verdict"]
        }
        Update: {
          agent_trace?: Json
          bear_case?: string | null
          bull_case?: string | null
          claim_checks?: Json
          comps?: Json
          confidence?: number | null
          created_at?: string | null
          founder_feedback?: string
          id?: string
          internal_memo?: string
          model_used?: string | null
          pitch_id?: string
          red_flags?: Json
          scores?: Json
          thesis_fit_summary?: string | null
          thesis_id?: string | null
          verdict?: Database["public"]["Enums"]["pitch_verdict"]
        }
        Relationships: []
      }
      pitches: {
        Row: {
          access_token: string
          company_name: string
          confidence: number | null
          created_at: string | null
          educational_disclaimer: string
          error_message: string | null
          file_mime: string | null
          file_name: string | null
          file_path: string | null
          founder_email: string
          founder_feedback: string | null
          founder_name: string
          id: string
          material_type: string | null
          one_liner: string
          pitch_narrative: string
          progress: Json
          status: Database["public"]["Enums"]["pitch_status"]
          updated_at: string | null
          verdict: Database["public"]["Enums"]["pitch_verdict"] | null
          video_url: string | null
          website_url: string | null
        }
        Insert: {
          access_token?: string
          company_name: string
          confidence?: number | null
          created_at?: string | null
          educational_disclaimer?: string
          error_message?: string | null
          file_mime?: string | null
          file_name?: string | null
          file_path?: string | null
          founder_email: string
          founder_feedback?: string | null
          founder_name: string
          id?: string
          material_type?: string | null
          one_liner: string
          pitch_narrative: string
          progress?: Json
          status?: Database["public"]["Enums"]["pitch_status"]
          updated_at?: string | null
          verdict?: Database["public"]["Enums"]["pitch_verdict"] | null
          video_url?: string | null
          website_url?: string | null
        }
        Update: {
          access_token?: string
          company_name?: string
          confidence?: number | null
          created_at?: string | null
          educational_disclaimer?: string
          error_message?: string | null
          file_mime?: string | null
          file_name?: string | null
          file_path?: string | null
          founder_email?: string
          founder_feedback?: string | null
          founder_name?: string
          id?: string
          material_type?: string | null
          one_liner?: string
          pitch_narrative?: string
          progress?: Json
          status?: Database["public"]["Enums"]["pitch_status"]
          updated_at?: string | null
          verdict?: Database["public"]["Enums"]["pitch_verdict"] | null
          video_url?: string | null
          website_url?: string | null
        }
        Relationships: []
      }
      site_content: {
        Row: {
          content_key: string
          content_value: Json
          id: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          content_key: string
          content_value: Json
          id?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          content_key?: string
          content_value?: Json
          id?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      waitlist_users: {
        Row: {
          created_at: string | null
          email: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      count_admins: { Args: never; Returns: number }
      get_pitch_status: {
        Args: { p_id: string; p_token: string }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      submit_pitch: {
        Args: {
          p_company_name: string
          p_file_mime?: string | null
          p_file_name?: string | null
          p_file_path?: string | null
          p_founder_email: string
          p_founder_name: string
          p_material_type?: string | null
          p_one_liner: string
          p_pitch_narrative: string
          p_video_url?: string | null
          p_website_url?: string | null
        }
        Returns: Json
      }
    }
    Enums: {
      app_role: "admin" | "user"
      pitch_status: "submitted" | "reviewing" | "completed" | "failed"
      pitch_verdict: "HOT" | "WARM" | "PASS"
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
      app_role: ["admin", "user"],
    },
  },
} as const
