import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {BookOpen, Check, ChevronDown, Copy, Crown, Expand, LogOut, MessageCircle, Moon, Send, Shield, Sun, Users, Wifi, WifiOff, X} from 'lucide-react';
import type {RealtimeChannel} from '@supabase/supabase-js';
import {isConfigured,supabase} from './client';
import type {ChatMessage,ChatView,Member,Room} from './types';
import {normalizeCode,safeError,validNickname} from './types';

const storageKey='valoria:last-room:v1';
const limit=500;

function useStoredTheme(){
  const [dark,setDark]=useState(()=>localStorage.getItem('valoria:theme')!=='light');
  useEffect(()=>{localStorage.setItem('valoria:theme',dark?'dark':'light');document.documentElement.dataset.theme=dark?'dark':'light'},[dark]);
  return [dark,setDark] as const;
}
function isActiveRoom(v:unknown):v is Room {return Boolean(v&&typeof v==='object'&&'id' in v&&'code' in v)}

export default function App(){
  const [dark,setDark]=useStoredTheme();
  const [userId,setUserId]=useState<string|null>(null);
  const [booting,setBooting]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [room,setRoom]=useState<Room|null>(null);
  const [members,setMembers]=useState<Member[]>([]);
  const [messages,setMessages]=useState<ChatMessage[]>([]);
  const [roomCode,setRoomCode]=useState('');
  const [nickname,setNickname]=useState(()=>localStorage.getItem('valoria:nickname')??'');
  const [days,setDays]=useState<10|15|30>(10);
  const [createMode,setCreateMode]=useState(true);
  const [chatView,setChatView]=useState<ChatView>('compact');
  const [unread,setUnread]=useState(0);
  const [muted,setMuted]=useState(false);
  const [connection,setConnection]=useState('Disconnected');
  const [showGuide,setShowGuide]=useState(false);
  const currentRoomRef=useRef<string|null>(null);
  const userRef=useRef<string|null>(null);
  const chatOpenRef=useRef(true);
  const mutedRef=useRef(false);
  const lastMessageId=useRef(0);
  const mounted=useRef(true);
  const pendingRefresh=useRef(false);

  const loadRoom=useCallback(async(roomId:string)=>{
    if(!supabase)return;
    const [r,m]=await Promise.all([
      supabase.from('valoria_rooms').select('id,code,host_id,phase,game_days,created_at').eq('id',roomId).maybeSingle(),
      supabase.from('valoria_members').select('room_id,user_id,nickname,joined_at').eq('room_id',roomId).order('joined_at',{ascending:true})
    ]);
    if(r.error)throw r.error;if(m.error)throw m.error;
    if(!isActiveRoom(r.data)){if(currentRoomRef.current===roomId){setRoom(null);localStorage.removeItem(storageKey)}return;}
    if(currentRoomRef.current!==roomId)return;
    setRoom(r.data as Room);setMembers((m.data??[]) as Member[]);
  },[]);
  const loadMessages=useCallback(async(roomId:string)=>{
    if(!supabase)return;
    const {data,error:loadError}=await supabase.from('valoria_messages')
      .select('id,room_id,sender_id,body,created_at,client_nonce')
      .eq('room_id',roomId).order('id',{ascending:false}).limit(100);
    if(loadError)throw loadError;
    if(currentRoomRef.current!==roomId)return;
    const sorted=((data??[]) as ChatMessage[]).reverse();
    const newest=sorted.at(-1)?.id??0;
    if(newest>lastMessageId.current && lastMessageId.current>0 && !chatOpenRef.current && !mutedRef.current){
      const missed=sorted.filter(m=>m.id>lastMessageId.current&&m.sender_id!==userRef.current).length;
      if(missed)setUnread(v=>v+missed);
    }
    lastMessageId.current=Math.max(lastMessageId.current,newest);
    setMessages(sorted);
  },[]);
  const attachRoom=useCallback(async(id:string)=>{
    currentRoomRef.current=id;localStorage.setItem(storageKey,id);
    lastMessageId.current=0;setMessages([]);setUnread(0);setError('');
    await Promise.all([loadRoom(id),loadMessages(id)]);
  },[loadRoom,loadMessages]);

  useEffect(()=>{
    mounted.current=true;
    if(!supabase){setBooting(false);return}
    const client=supabase;
    (async()=>{
      try{
        let {data:{session},error:sessionError}=await client.auth.getSession();
        if(sessionError)throw sessionError;
        if(!session){const anon=await client.auth.signInAnonymously();if(anon.error)throw anon.error;session=anon.data.session}
        if(!session)throw new Error('Unable to start guest session');
        userRef.current=session.user.id;setUserId(session.user.id);
        await client.realtime.setAuth(session.access_token);
        const cached=localStorage.getItem(storageKey);
        if(cached){await attachRoom(cached)}
      }catch(e){setError(safeError((e as Error).message||'Could not connect'))}
      finally{if(mounted.current)setBooting(false)}
    })();
    const {data:{subscription}}=client.auth.onAuthStateChange((_event,session)=>{
      if(session){userRef.current=session.user.id;setUserId(session.user.id)}
    });
    return()=>{mounted.current=false;subscription.unsubscribe()};
  },[attachRoom]);

  useEffect(()=>{
    if(!supabase||!room?.id)return;
    const client=supabase;
    const id=room.id;
    let alive=true;
    const onChange=()=>{
      if(!alive||pendingRefresh.current)return;
      pendingRefresh.current=true;
      void Promise.all([loadRoom(id),loadMessages(id)]).catch(e=>{if(alive)setError(safeError((e as Error).message))}).finally(()=>{pendingRefresh.current=false});
    };
    const channel:RealtimeChannel=client.channel('valoria-room:'+id,{config:{private:true}})
      .on('postgres_changes',{event:'*',schema:'public',table:'valoria_members',filter:`room_id=eq.${id}`},onChange)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'valoria_messages',filter:`room_id=eq.${id}`},onChange)
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'valoria_rooms',filter:`id=eq.${id}`},onChange)
      .subscribe(status=>{if(alive)setConnection(status)});
    const poll=window.setInterval(onChange,15000);
    const wake=()=>onChange();
    window.addEventListener('focus',wake);
    return()=>{alive=false;window.clearInterval(poll);window.removeEventListener('focus',wake);void client.removeChannel(channel)};
  },[room?.id,loadRoom,loadMessages]);
  useEffect(()=>{chatOpenRef.current=chatView!=='closed';if(chatView!=='closed')setUnread(0)},[chatView]);
  useEffect(()=>{mutedRef.current=muted;if(muted)setUnread(0)},[muted]);
  useEffect(()=>{if(room?.phase==='lobby')setChatView('compact')},[room?.phase]);

  const act=async(f:()=>Promise<void>)=>{
    setBusy(true);setError('');
    try{await f()}catch(e){setError(safeError((e as Error)?.message??'Request failed'))}
    finally{setBusy(false)}
  };
  const create=()=>void act(async()=>{
    if(!validNickname(nickname))throw new Error('Choose a nickname: 2–24 letters, numbers or simple punctuation');
    if(!supabase)throw new Error('Connect Supabase first');
    const {data,error:rpcError}=await supabase.rpc('valoria_create_room',{p_nickname:nickname.trim(),p_days:days});
    if(rpcError)throw rpcError;
    localStorage.setItem('valoria:nickname',nickname.trim());
    await attachRoom(data as string);
  });
  const join=()=>void act(async()=>{
    if(!validNickname(nickname))throw new Error('Choose a nickname: 2–24 letters, numbers or simple punctuation');
    if(roomCode.length!==10)throw new Error('Enter the full 10-character room code');
    if(!supabase)throw new Error('Connect Supabase first');
    const {data,error:rpcError}=await supabase.rpc('valoria_join_room',{p_code:roomCode,p_nickname:nickname.trim()});
    if(rpcError)throw rpcError;
    localStorage.setItem('valoria:nickname',nickname.trim());
    await attachRoom(data as string);
  });
  const leave=()=>void act(async()=>{
    if(!supabase||!room)return;
    if(room.phase!=='lobby')throw new Error('Active game rooms are saved; reconnect rather than leaving');
    const {error:rpcError}=await supabase.rpc('valoria_leave_room',{p_room:room.id});
    if(rpcError)throw rpcError;
    currentRoomRef.current=null;localStorage.removeItem(storageKey);setRoom(null);setMessages([]);setMembers([]);setConnection('Disconnected');
  });
  const start=()=>void act(async()=>{
    if(!supabase||!room)return;
    const {error:rpcError}=await supabase.rpc('valoria_start_room',{p_room:room.id});
    if(rpcError)throw rpcError;
    await loadRoom(room.id);
  });
  const send=async(body:string,nonce:string)=>{
    if(!supabase||!room)throw new Error('Not in a room');
    const {error:rpcError}=await supabase.rpc('valoria_send_message',{p_room:room.id,p_body:body,p_nonce:nonce});
    if(rpcError)throw rpcError;
    await loadMessages(room.id);
  };
  const canStart=room?.host_id===userId && members.length>=2;
  const isHost=room?.host_id===userId;
  const myName=members.find(x=>x.user_id===userId)?.nickname??nickname;
  const roomTitle=room?.phase==='lobby'?'The Merchant’s Inn':'The Kingdom of Valoria';
  const connected=connection==='SUBSCRIBED';
  const playerCount=members.length;
  const headerActions=<div className="top-actions">
      {room&&<span className="connection" title={`Realtime connection: ${connection}`}>{connected?<Wifi size={15}/>:<WifiOff size={15}/>}<span>{connected?'Connected':'Syncing'}</span></span>}
      <button className="icon-button" aria-label="Toggle light or dark theme" onClick={()=>setDark(!dark)} title="Change theme">{dark?<Sun size={19}/>:<Moon size={19}/>}</button>
      <button className="icon-button" onClick={()=>setShowGuide(!showGuide)} aria-label="Help and controls" title="Help"><BookOpen size={19}/></button>
    </div>;
  const visibleNames=useMemo(()=>new Map(members.map(m=>[m.user_id,m.nickname])),[members]);

  return <div className="app-shell">
    <div className="stars" aria-hidden="true"/>
    <header className="header">
      <div className="brand" role="banner"><span className="brand-mark">✦</span><span className="brand-word">VALORIA</span><span className="brand-sub">MERCHANTS OF THE KINGDOM</span></div>
      <span className="header-center">{room?roomTitle:'A realm of trade, wit & fortune'}</span>
      {headerActions}
    </header>
    {error&&<div className="error-banner" role="alert"><Shield size={16}/><span>{error}</span><button onClick={()=>setError('')} aria-label="Dismiss error"><X size={16}/></button></div>}
    {showGuide&&<aside className="guide-panel"><button className="close-x" onClick={()=>setShowGuide(false)} aria-label="Close help"><X size={18}/></button><h2>The Merchant’s Guide</h2><p>Create a room or join using a private invitation code. Your nickname is public to other room members; your guest identity is private.</p><p>Room chat continues from the lobby to the game. Up to four players can participate, and the host starts the match after at least two merchants arrive.</p><p><strong>Milestone 1:</strong> trading and day resolution are not enabled yet. We are testing rooms, secure membership, chat and reconnection first.</p></aside>}
    {!isConfigured&&<div className="setup-banner" role="status"><Shield size={18}/> Supabase is not configured. Add the public URL and publishable key to <code>.env</code> to activate rooms and chat. No live multiplayer connection is available in this preview.</div>}
    {booting?<main className="center-stage"><div className="crest-large">✦</div><h1>Opening the kingdom gates…</h1><p>Preparing your guest identity.</p></main>:
      !room?<main className="entry-layout">
        <section className="entry-art"><div className="entry-illustration" aria-hidden="true"><div className="moon-disc"/><div className="hill h1"/><div className="hill h2"/><div className="castle"><div className="tower t1"/><div className="keep"/><div className="tower t2"/></div><div className="river"/></div><span className="kicker">THE REALM AWAITS</span><h1>Gather your fellow<br/>merchants.</h1><p>A kingdom is built on bargains, alliances and a little cunning.</p></section>
        <section className="parchment entry-panel">
          <div className="panel-ornament">❧ ❦ ❧</div>
          <h2>Enter the Merchant’s Inn</h2><p className="muted">Begin your journey with friends.</p>
          <div className="tab-line"><button className={createMode?'selected':''} onClick={()=>setCreateMode(true)}>Create room</button><button className={!createMode?'selected':''} onClick={()=>setCreateMode(false)}>Join room</button></div>
          <label className="field-label" htmlFor="nickname">Your merchant name</label>
          <input id="nickname" maxLength={24} autoComplete="nickname" placeholder="e.g. The Golden Fox" value={nickname} onChange={e=>setNickname(e.target.value)}/>
          {createMode?<><label className="field-label" htmlFor="days">Length of journey</label><select id="days" value={days} onChange={e=>setDays(Number(e.target.value) as 10|15|30)}><option value={10}>10 days — Short campaign</option><option value={15}>15 days — Standard campaign</option><option value={30}>30 days — Grand campaign</option></select><p className="field-help">2–4 players · Private room · Continuous chat</p></>:
          <><label className="field-label" htmlFor="invite">Room invitation code</label><input id="invite" value={roomCode} onChange={e=>setRoomCode(normalizeCode(e.target.value))} maxLength={10} placeholder="A1B2C3D4E5" autoCapitalize="characters" spellCheck={false}/><p className="field-help">Ask the host for their 10-character invitation.</p></>}
          <button disabled={busy||!userId||!isConfigured} className="primary-action full" onClick={createMode?create:join}>{busy?'Opening the gates…':createMode?'Create a Private Room':'Enter the Room'}<span>↗</span></button>
          <div className="security-note"><Shield size={16}/>No email or password required for this prototype.</div>
        </section>
      </main>:
      <main className={`room-layout ${room.phase==='lobby'?'is-lobby':'is-game'}`}>
        <section className="game-main">
          {room.phase==='lobby'?<>
            <div className="section-strap"><span>EST. IN THE KINGDOM OF VALORIA</span><span>THE GUILD GATHERS</span></div>
            <div className="room-heading"><div><span className="kicker">WELCOME, {myName.toUpperCase()}</span><h1>The Merchant’s Inn</h1><p>Gather the guild before embarking on your journey.</p></div><div className="coat-of-arms" aria-hidden="true"><Crown size={34}/></div></div>
            <div className="lobby-columns">
              <section className="parchment room-card"><div className="card-title"><Users size={19}/> <h2>The Merchant Council</h2><span className="pill">{playerCount} / 4</span></div>
                <div className="player-list">{members.map((m,i)=><div className="player-entry" key={m.user_id}><span className={`avatar avatar-${i}`} aria-hidden="true">{['♜','♞','♟','♛'][i]}</span><div className="player-descriptor"><strong>{m.nickname}</strong><small>{m.user_id===room.host_id?'Guild master':m.user_id===userId?'You · Merchant':'Fellow merchant'}</small></div>{m.user_id===room.host_id?<Crown size={17} className="gold"/>:<Check size={16}/>}</div>)}{Array.from({length:Math.max(0,4-playerCount)}).map((_,i)=><div className="waiting-player" key={i}><span className="waiting-avatar">+</span><span>Awaiting a merchant…</span></div>)}</div>
              </section>
              <section className="parchment invite-card"><div className="card-title"><Shield size={19}/><h2>Room Charter</h2></div><span className="field-label">INVITATION CODE</span><div className="code-row"><strong>{room.code}</strong><button className="small-icon" onClick={()=>void navigator.clipboard?.writeText(room.code)} title="Copy invite code" aria-label="Copy invite code"><Copy size={19}/></button></div><div className="charter-line"><span>Campaign</span><strong>{room.game_days} days</strong></div><div className="charter-line"><span>Participation</span><strong>{playerCount} of 4 merchants</strong></div><div className="charter-line"><span>Room privacy</span><strong>Invitation only</strong></div><div className="charter-actions">{isHost?<button disabled={busy||!canStart} className="primary-action" onClick={start}>{busy?'Opening…':'Begin the Journey'}<span>↗</span></button>:<div className="muted waiting-text">Waiting for the guild master to begin…</div>}<button disabled={busy} className="text-action" onClick={leave}><LogOut size={15}/> Leave the Inn</button></div></section>
            </div>
          </>:
          <><div className="section-strap"><span>THE KINGDOM OF VALORIA</span><span>FOUNDATION TEST</span></div><div className="game-scene"><div className="game-map" aria-hidden="true"><div className="map-marker marker-one">♜ <span>Merchant’s Inn</span></div><div className="map-marker marker-two">⚖ <span>Marketplace</span></div><div className="map-marker marker-three">♛ <span>Royal Council</span></div></div><div className="game-placeholder parchment"><span className="kicker">GUILD ASSEMBLED</span><h1>The realm is open</h1><p>Your lobby and room chat are now connected. Marketplace, orders and day progression arrive in later milestones.</p><div className="mock-summary"><span><Users size={16}/> {playerCount} merchants</span><span>{room.game_days}-day match</span></div><strong className="status-chip">Milestone 1 · Multiplayer foundation</strong></div></div></>}
        </section>
        {chatView!=='closed'&&<ChatPanel key={room.id} view={chatView} room={room} myId={userId!} names={visibleNames} messages={messages} onSend={send} onExpand={()=>setChatView(chatView==='expanded'?'compact':'expanded')} onClose={()=>setChatView('closed')} muted={muted} onMute={()=>setMuted(v=>!v)}/>}
        {chatView==='closed'&&<button className="floating-chat" onClick={()=>{setChatView('compact');setUnread(0)}} aria-label={`Open room chat${unread?' '+unread+' unread messages':''}`}><MessageCircle size={22}/>{unread>0&&<span className="unread-bubble">{Math.min(unread,99)}</span>}</button>}
      </main>}
    <footer className="footer"><span>✦ THE GUILD OF VALORIA ✦</span><span className="footer-controls">{room?<><span>{room.phase==='lobby'?'THE INN':'THE REALM'} · {room.code}</span><button className="footer-chat" onClick={()=>{setChatView('compact');setUnread(0)}}><MessageCircle size={15}/> Chat{unread?` (${unread})`:''}</button></>:<span>AN ADVENTURE SHARED IS A FORTUNE MADE</span>}</span></footer>
  </div>;
}

interface ChatProps {room:Room; myId:string;names:Map<string,string>;messages:ChatMessage[];view:ChatView;onSend:(body:string,nonce:string)=>Promise<void>;onExpand:()=>void;onClose:()=>void;muted:boolean;onMute:()=>void}
function ChatPanel({room,myId,names,messages,view,onSend,onExpand,onClose,muted,onMute}:ChatProps){
  const [draft,setDraft]=useState('');
  const [sending,setSending]=useState(false);
  const [sendError,setSendError]=useState('');
  const endRef=useRef<HTMLDivElement|null>(null);
  useEffect(()=>{endRef.current?.scrollIntoView({behavior:'smooth',block:'nearest'})},[messages.length]);
  const submit=async()=>{
    const message=draft.trim();if(!message||sending)return;
    setSending(true);setSendError('');
    try{await onSend(message,crypto.randomUUID());setDraft('')}
    catch(e){setSendError(safeError((e as Error).message))}
    finally{setSending(false)}
  };
  return <aside className={`chat-panel ${view==='expanded'?'expanded':''} ${room.phase==='lobby'?'chat-lobby':'chat-game'}`} aria-label="Room chat">
    <div className="chat-header"><div className="chat-header-title"><MessageCircle size={20}/><div><strong>Room Chat</strong><small>THE GUILD'S CONVERSATION</small></div></div><div className="chat-tools"><button onClick={onMute} title={muted?'Unmute chat indicators':'Mute chat indicators'} aria-label={muted?'Unmute chat':'Mute chat'}>{muted?'♩':'♫'}</button><button onClick={onExpand} title={view==='expanded'?'Compact chat':'Expand chat'} aria-label={view==='expanded'?'Compact chat':'Expand chat'}>{view==='expanded'?<ChevronDown size={19}/>:<Expand size={16}/>}</button>{room.phase!=='lobby'&&<button onClick={onClose} aria-label="Close chat"><X size={18}/></button>}</div></div>
    <div className="chat-rule"><span>✦</span> ONE CONVERSATION THROUGHOUT THE MATCH <span>✦</span></div>
    <div className="messages" role="log" aria-live="polite" aria-relevant="additions text">
      {messages.length===0?<div className="chat-empty"><span>❦</span><h3>The tavern awaits its first tale.</h3><p>Greet your fellow merchants.</p></div>:<>
        {messages.length===100&&<p className="history-note">Showing the newest 100 messages; older history remains saved.</p>}
        {messages.map((msg,i)=>{const mine=msg.sender_id===myId;return <div className={`chat-message ${mine?'mine':''}`} key={msg.id}><div className={`chat-avatar chat-avatar-${i%4}`}>{mine?'✦':names.get(msg.sender_id)?.[0]?.toUpperCase()??'?'}</div><div className="chat-message-content"><div className="message-meta"><strong>{mine?'You':names.get(msg.sender_id)??'Former merchant'}</strong><time dateTime={msg.created_at}>{new Date(msg.created_at).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}</time></div><p>{msg.body}</p></div></div>})}</>}
      <div ref={endRef}/>
    </div>
    <form className="chat-compose" onSubmit={e=>{e.preventDefault();void submit()}}><div className="compose-line"><input value={draft} onChange={e=>setDraft(e.target.value.slice(0,limit))} aria-label="Chat message" placeholder="Speak to the guild…" maxLength={limit} autoComplete="off"/><button type="submit" disabled={sending||!draft.trim()} className="send-button" aria-label="Send chat message"><Send size={17}/></button></div><div className="compose-hint"><span>{sendError?<span className="chat-error" role="alert">{sendError}</span>:"Messages are visible only to room members"}</span><span>{draft.length}/{limit}</span></div></form>
  </aside>;
}
