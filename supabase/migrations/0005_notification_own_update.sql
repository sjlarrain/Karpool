-- Polish sweep — the in-app notification bell needs to mark rows read, but 0001_init.sql only ever
-- created a SELECT policy on `notification`. Without a matching UPDATE policy, a mark-read from the
-- caller's session-scoped client silently updates zero rows (RLS filters the write, it does not
-- error), so the unread dot would never clear.
--
-- Scoped exactly like the existing select policy: a caller may only touch their own rows, and the
-- with-check clause stops a row being reassigned to someone else's profile_id.

create policy notification_own_update on notification for update
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());
