// Hand-written from supabase/migrations/0001_init.sql — `pnpm db:types` normally generates this
// file from a running local Supabase instance, which needs Docker (unavailable in this session's
// environment, see docs/WORKLOG.md). Regenerate with `pnpm db:types` once Docker is available and
// delete this note; verify it matches before trusting it over the migration.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      profile: {
        Row: {
          id: string;
          display_name: string;
          initials: string;
          avatar_color: string;
          platform_role: "member" | "platform_admin";
          last_seen_at: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          display_name: string;
          initials: string;
          avatar_color: string;
          platform_role?: "member" | "platform_admin";
          last_seen_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profile"]["Insert"]>;
        Relationships: [];
      };
      group: {
        Row: {
          id: string;
          name: string;
          origin_label: string;
          dest_label: string;
          code: string;
          cost_split_note: string | null;
          drive_weight: number;
          pool_weight: number;
          kudos_weight: number;
          late_window_minutes: number;
          late_penalty: number;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          origin_label: string;
          dest_label: string;
          code: string;
          cost_split_note?: string | null;
          drive_weight?: number;
          pool_weight?: number;
          kudos_weight?: number;
          late_window_minutes?: number;
          late_penalty?: number;
          created_by: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["group"]["Insert"]>;
        Relationships: [];
      };
      pickup_place: {
        Row: {
          id: string;
          group_id: string;
          label: string;
          address: string;
          typical_time: string | null;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          group_id: string;
          label: string;
          address: string;
          typical_time?: string | null;
          sort_order?: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["pickup_place"]["Insert"]>;
        Relationships: [];
      };
      membership: {
        Row: {
          id: string;
          group_id: string;
          profile_id: string;
          group_role: "member" | "group_admin";
          pickup_place_id: string | null;
          joined_at: string;
        };
        Insert: {
          id?: string;
          group_id: string;
          profile_id: string;
          group_role?: "member" | "group_admin";
          pickup_place_id?: string | null;
          joined_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["membership"]["Insert"]>;
        Relationships: [];
      };
      trip: {
        Row: {
          id: string;
          group_id: string;
          driver_id: string;
          direction: "out" | "back" | "round";
          depart_at: string;
          return_at: string | null;
          capacity: number;
          status: "scheduled" | "started" | "closed" | "cancelled";
          started_at: string | null;
          closed_at: string | null;
          cancelled_reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          group_id: string;
          driver_id: string;
          direction: "out" | "back" | "round";
          depart_at: string;
          return_at?: string | null;
          capacity: number;
          status?: "scheduled" | "started" | "closed" | "cancelled";
          started_at?: string | null;
          closed_at?: string | null;
          cancelled_reason?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["trip"]["Insert"]>;
        Relationships: [];
      };
      trip_rider: {
        Row: {
          id: string;
          trip_id: string;
          profile_id: string | null;
          guest_name: string | null;
          pickup_place_id: string | null;
          stop_order: number | null;
          state: "joined" | "left" | "confirmed" | "no_show";
          joined_at: string;
          left_at: string | null;
        };
        Insert: {
          id?: string;
          trip_id: string;
          profile_id?: string | null;
          guest_name?: string | null;
          pickup_place_id?: string | null;
          stop_order?: number | null;
          state?: "joined" | "left" | "confirmed" | "no_show";
          joined_at?: string;
          left_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["trip_rider"]["Insert"]>;
        Relationships: [];
      };
      kudos: {
        Row: {
          id: string;
          trip_id: string;
          from_profile_id: string;
          to_profile_id: string;
          comment: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          trip_id: string;
          from_profile_id: string;
          to_profile_id: string;
          comment?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["kudos"]["Insert"]>;
        Relationships: [];
      };
      points_ledger: {
        Row: {
          id: string;
          profile_id: string;
          group_id: string;
          trip_id: string | null;
          kind: "drive" | "pool" | "kudos" | "late_leave" | "admin_adjust";
          points: number;
          reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          group_id: string;
          trip_id?: string | null;
          kind: "drive" | "pool" | "kudos" | "late_leave" | "admin_adjust";
          points: number;
          reason?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["points_ledger"]["Insert"]>;
        Relationships: [];
      };
      notification: {
        Row: {
          id: string;
          profile_id: string;
          type: "start" | "rate" | "change" | "comment" | "tip";
          title: string;
          body: string | null;
          payload: Json | null;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          type: "start" | "rate" | "change" | "comment" | "tip";
          title: string;
          body?: string | null;
          payload?: Json | null;
          read_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["notification"]["Insert"]>;
        Relationships: [];
      };
      push_subscription: {
        Row: {
          id: string;
          profile_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent: string | null;
          last_success_at: string | null;
          failure_count: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent?: string | null;
          last_success_at?: string | null;
          failure_count?: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["push_subscription"]["Insert"]>;
        Relationships: [];
      };
      audit_log: {
        Row: {
          id: string;
          actor_profile_id: string | null;
          action: string;
          entity_type: string;
          entity_id: string | null;
          before: Json | null;
          after: Json | null;
          ip: string | null;
          user_agent: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor_profile_id?: string | null;
          action: string;
          entity_type: string;
          entity_id?: string | null;
          before?: Json | null;
          after?: Json | null;
          ip?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["audit_log"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      is_member: {
        Args: { p_group_id: string };
        Returns: boolean;
      };
      compute_initials: {
        Args: { full_name: string };
        Returns: string;
      };
    };
    Enums: Record<string, never>;
  };
}
