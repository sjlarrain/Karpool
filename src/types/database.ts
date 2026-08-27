// Generated via `pnpm db:types:linked` (`supabase gen types typescript --linked`) against the live
// project, then hand-patched: columns backed by a CHECK constraint (not a native Postgres enum)
// come back as `string` from the generator, so this restores literal-union types for those columns
// (trip.status, trip.direction, trip_rider.state — including join_trip()'s Returns shape —
// membership.group_role, profile.platform_role, points_ledger.kind, notification.type) to match
// supabase/migrations/*.sql. Regenerate with `pnpm db:types:linked` and reapply those patches if the
// schema changes.

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
    PostgrestVersion: "14.15"
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
      audit_log: {
        Row: {
          action: string
          actor_profile_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          ip: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_profile_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          ip?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_profile_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profile"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          category: "bug" | "idea" | "praise" | "other"
          created_at: string
          group_id: string | null
          id: string
          message: string
          profile_id: string | null
          user_agent: string | null
        }
        Insert: {
          category: "bug" | "idea" | "praise" | "other"
          created_at?: string
          group_id?: string | null
          id?: string
          message: string
          profile_id?: string | null
          user_agent?: string | null
        }
        Update: {
          category?: "bug" | "idea" | "praise" | "other"
          created_at?: string
          group_id?: string | null
          id?: string
          message?: string
          profile_id?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profile"
            referencedColumns: ["id"]
          },
        ]
      }
      group: {
        Row: {
          code: string
          cost_split_note: string | null
          created_at: string
          created_by: string
          dest_label: string
          drive_weight: number
          id: string
          kudos_weight: number
          late_penalty: number
          late_window_minutes: number
          name: string
          origin_label: string
          no_show_penalty: number
          pool_step: number
          pool_weight: number
        }
        Insert: {
          code: string
          cost_split_note?: string | null
          created_at?: string
          created_by: string
          dest_label: string
          drive_weight?: number
          id?: string
          kudos_weight?: number
          late_penalty?: number
          late_window_minutes?: number
          name: string
          origin_label: string
          no_show_penalty?: number
          pool_step?: number
          pool_weight?: number
        }
        Update: {
          code?: string
          cost_split_note?: string | null
          created_at?: string
          created_by?: string
          dest_label?: string
          drive_weight?: number
          id?: string
          kudos_weight?: number
          late_penalty?: number
          late_window_minutes?: number
          name?: string
          origin_label?: string
          no_show_penalty?: number
          pool_step?: number
          pool_weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "group_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profile"
            referencedColumns: ["id"]
          },
        ]
      }
      kudos: {
        Row: {
          comment: string | null
          created_at: string
          from_profile_id: string
          id: string
          to_profile_id: string
          trip_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          from_profile_id: string
          id?: string
          to_profile_id: string
          trip_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          from_profile_id?: string
          id?: string
          to_profile_id?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kudos_from_profile_id_fkey"
            columns: ["from_profile_id"]
            isOneToOne: false
            referencedRelation: "profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kudos_to_profile_id_fkey"
            columns: ["to_profile_id"]
            isOneToOne: false
            referencedRelation: "profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kudos_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trip"
            referencedColumns: ["id"]
          },
        ]
      }
      membership: {
        Row: {
          group_id: string
          group_role: "member" | "group_admin"
          id: string
          joined_at: string
          pickup_place_id: string | null
          profile_id: string
        }
        Insert: {
          group_id: string
          group_role?: "member" | "group_admin"
          id?: string
          joined_at?: string
          pickup_place_id?: string | null
          profile_id: string
        }
        Update: {
          group_id?: string
          group_role?: "member" | "group_admin"
          id?: string
          joined_at?: string
          pickup_place_id?: string | null
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_pickup_place_id_fkey"
            columns: ["pickup_place_id"]
            isOneToOne: false
            referencedRelation: "pickup_place"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profile"
            referencedColumns: ["id"]
          },
        ]
      }
      notification: {
        Row: {
          body: string | null
          created_at: string
          id: string
          payload: Json | null
          profile_id: string
          read_at: string | null
          title: string
          type: "start" | "rate" | "change" | "comment" | "tip" | "reminder"
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          payload?: Json | null
          profile_id: string
          read_at?: string | null
          title: string
          type: "start" | "rate" | "change" | "comment" | "tip" | "reminder"
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          payload?: Json | null
          profile_id?: string
          read_at?: string | null
          title?: string
          type?: "start" | "rate" | "change" | "comment" | "tip" | "reminder"
        }
        Relationships: [
          {
            foreignKeyName: "notification_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profile"
            referencedColumns: ["id"]
          },
        ]
      }
      pickup_place: {
        Row: {
          address: string
          created_at: string
          group_id: string
          id: string
          label: string
          sort_order: number
          typical_time: string | null
        }
        Insert: {
          address: string
          created_at?: string
          group_id: string
          id?: string
          label: string
          sort_order?: number
          typical_time?: string | null
        }
        Update: {
          address?: string
          created_at?: string
          group_id?: string
          id?: string
          label?: string
          sort_order?: number
          typical_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pickup_place_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group"
            referencedColumns: ["id"]
          },
        ]
      }
      points_ledger: {
        Row: {
          created_at: string
          group_id: string
          id: string
          kind: "drive" | "pool" | "kudos" | "late_leave" | "no_show" | "admin_adjust"
          points: number
          profile_id: string
          reason: string | null
          trip_id: string | null
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          kind: "drive" | "pool" | "kudos" | "late_leave" | "no_show" | "admin_adjust"
          points: number
          profile_id: string
          reason?: string | null
          trip_id?: string | null
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          kind?: "drive" | "pool" | "kudos" | "late_leave" | "no_show" | "admin_adjust"
          points?: number
          profile_id?: string
          reason?: string | null
          trip_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "points_ledger_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "points_ledger_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "points_ledger_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trip"
            referencedColumns: ["id"]
          },
        ]
      }
      profile: {
        Row: {
          avatar_color: string
          created_at: string
          display_name: string
          id: string
          initials: string
          last_seen_at: string | null
          platform_role: "member" | "platform_admin"
        }
        Insert: {
          avatar_color: string
          created_at?: string
          display_name: string
          id: string
          initials: string
          last_seen_at?: string | null
          platform_role?: "member" | "platform_admin"
        }
        Update: {
          avatar_color?: string
          created_at?: string
          display_name?: string
          id?: string
          initials?: string
          last_seen_at?: string | null
          platform_role?: "member" | "platform_admin"
        }
        Relationships: []
      }
      push_subscription: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          failure_count: number
          id: string
          last_success_at: string | null
          p256dh: string
          profile_id: string
          user_agent: string | null
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          failure_count?: number
          id?: string
          last_success_at?: string | null
          p256dh: string
          profile_id: string
          user_agent?: string | null
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          failure_count?: number
          id?: string
          last_success_at?: string | null
          p256dh?: string
          profile_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "push_subscription_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profile"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_hit: {
        Row: {
          action: string
          created_at: string
          id: string
          profile_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          profile_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rate_limit_hit_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profile"
            referencedColumns: ["id"]
          },
        ]
      }
      trip: {
        Row: {
          cancelled_reason: string | null
          capacity: number
          closed_at: string | null
          created_at: string
          depart_at: string
          direction: "out" | "back" | "round"
          driver_id: string
          group_id: string
          id: string
          return_at: string | null
          started_at: string | null
          status: "scheduled" | "started" | "closed" | "cancelled"
        }
        Insert: {
          cancelled_reason?: string | null
          capacity: number
          closed_at?: string | null
          created_at?: string
          depart_at: string
          direction: "out" | "back" | "round"
          driver_id: string
          group_id: string
          id?: string
          return_at?: string | null
          started_at?: string | null
          status?: "scheduled" | "started" | "closed" | "cancelled"
        }
        Update: {
          cancelled_reason?: string | null
          capacity?: number
          closed_at?: string | null
          created_at?: string
          depart_at?: string
          direction?: "out" | "back" | "round"
          driver_id?: string
          group_id?: string
          id?: string
          return_at?: string | null
          started_at?: string | null
          status?: "scheduled" | "started" | "closed" | "cancelled"
        }
        Relationships: [
          {
            foreignKeyName: "trip_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_rider: {
        Row: {
          added_by_profile_id: string | null
          guest_name: string | null
          id: string
          joined_at: string
          kudos_declined_at: string | null
          left_at: string | null
          pickup_place_id: string | null
          profile_id: string | null
          state: "joined" | "left" | "confirmed" | "no_show"
          stop_order: number | null
          trip_id: string
        }
        Insert: {
          added_by_profile_id?: string | null
          guest_name?: string | null
          id?: string
          joined_at?: string
          kudos_declined_at?: string | null
          left_at?: string | null
          pickup_place_id?: string | null
          profile_id?: string | null
          state?: "joined" | "left" | "confirmed" | "no_show"
          stop_order?: number | null
          trip_id: string
        }
        Update: {
          added_by_profile_id?: string | null
          guest_name?: string | null
          id?: string
          joined_at?: string
          kudos_declined_at?: string | null
          left_at?: string | null
          pickup_place_id?: string | null
          profile_id?: string | null
          state?: "joined" | "left" | "confirmed" | "no_show"
          stop_order?: number | null
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_rider_added_by_profile_id_fkey"
            columns: ["added_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_rider_pickup_place_id_fkey"
            columns: ["pickup_place_id"]
            isOneToOne: false
            referencedRelation: "pickup_place"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_rider_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_rider_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trip"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      // Hand-added (0009): the generator can't see cron.* through the linked introspection, and
      // this wrapper is the only way the app reads the scheduler's health.
      carpool_cron_status: {
        Args: Record<string, never>
        Returns: {
          jobname: string
          schedule: string
          active: boolean
          last_run_at: string | null
          last_status: string | null
        }[]
      }
      compute_initials: { Args: { full_name: string }; Returns: string }
      is_member: { Args: { p_group_id: string }; Returns: boolean }
      // Hand-added (0010): D-24's driver-seats-a-member counterpart to join_trip, same row lock.
      add_trip_rider: {
        Args: { p_added_by: string; p_profile_id: string; p_trip_id: string }
        Returns: {
          added_by_profile_id: string | null
          guest_name: string | null
          id: string
          joined_at: string
          left_at: string | null
          pickup_place_id: string | null
          profile_id: string | null
          state: "joined" | "left" | "confirmed" | "no_show"
          stop_order: number | null
          trip_id: string
        }
        SetofOptions: {
          from: "*"
          to: "trip_rider"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      join_trip: {
        Args: { p_profile_id: string; p_trip_id: string }
        Returns: {
          added_by_profile_id: string | null
          guest_name: string | null
          id: string
          joined_at: string
          left_at: string | null
          pickup_place_id: string | null
          profile_id: string | null
          state: "joined" | "left" | "confirmed" | "no_show"
          stop_order: number | null
          trip_id: string
        }
        SetofOptions: {
          from: "*"
          to: "trip_rider"
          isOneToOne: true
          isSetofReturn: false
        }
      }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
