export type RoomPhase = 'lobby' | 'in_game' | 'results';
export interface Room { id: string; code: string; host_id: string; phase: RoomPhase; game_days: 10 | 15 | 30; created_at: string; }
export interface Member { room_id: string; user_id: string; nickname: string; joined_at: string; }
export interface ChatMessage { id: number; room_id: string; sender_id: string; body: string; created_at: string; client_nonce: string; }
export type ChatView = 'compact'|'expanded'|'closed';
export function normalizeCode(s:string):string {return s.replace(/[^a-f0-9]/gi,'').toUpperCase().slice(0,10)}
export function validNickname(s:string):boolean {return s.trim().length>=2 && s.trim().length<=24 && /^[\p{L}\p{N}_ .'-]+$/u.test(s.trim())}
export function safeError(message:string):string {return message.length>220?'Something went wrong. Try again.':message;}
