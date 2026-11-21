"""Dependency-free source contract checks. Not a substitute for Supabase integration tests."""
import re
from pathlib import Path
base=Path(__file__).resolve().parents[1]
sql=(base/'supabase/migrations/202611190001_milestone1.sql').read_text()
app=(base/'src/App.tsx').read_text()
client=(base/'src/client.ts').read_text()
print('Valoria Milestone 1 source checks')
tests={
  'all three tables have RLS':all(f'alter table public.{t} enable row level security;' in sql for t in ['valoria_rooms','valoria_members','valoria_messages']),
  'tables exposed read-only to authenticated browser': 'grant select on public.valoria_rooms, public.valoria_members, public.valoria_messages to authenticated' in sql and 'grant insert on public.valoria_messages' not in sql,
  'room and chat access requires membership':all('public.valoria_is_member' in x for x in re.findall(r'create policy[^;]+;',sql,re.S) if any(k in x for k in ['valoria room visible','valoria member list','valoria chat history'])),
  'security definer search path locked': len(re.findall(r'security definer set search_path = \'\'',sql))>=7,
  'capacity checked under exclusive room lock':'where code=p_code for update' in sql and ">=4" in sql,
  'only host starts when 2+ participants':"v_room.host_id <> auth.uid()" in sql and "< 2" in sql,
  'server message length & rate limit':"char_length(v_body) > 500" in sql and "v_count >= 5" in sql,
  'message retry idempotency': 'unique(sender_id,client_nonce)' in sql and 'where sender_id=auth.uid() and client_nonce=p_nonce' in sql,
  'leaving the lobby does not break message author relation':'foreign key(room_id,sender_id)' not in sql,
  'cannot leave an active game':'Cannot leave an active game' in sql,
  'realtime authorisation checks channel membership':'public.valoria_can_subscribe(realtime.topic())' in sql,
  'client never sends arbitrary chat broadcasts':".send({type:'broadcast'" not in app and "valoria_send_message" in app,
  'client never stores a server secret':'service_role' not in client and 'VITE_SUPABASE_PUBLISHABLE_KEY' in client,
  'continuous room chat rendered in both phases':"room.phase==='lobby'" in app and '<ChatPanel key={room.id}' in app,
  'browser rehydrates room on login': 'localStorage.getItem(storageKey)' in app and 'await attachRoom(cached)' in app,
  'safe message rendering via React JSX': '<p>{msg.body}</p>' in app and 'dangerouslySetInnerHTML' not in app,
}
for name, passed in tests.items(): print(('PASS' if passed else 'FAIL')+' '+name)
assert all(tests.values()),'Static checks failed'
print(f'{len(tests)} source-level checks passed. Live integration NOT tested.')
