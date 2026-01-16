export interface User {
  id: string;
  auth_user_id: string;
  created_at: Date;
  balance: number; // in 1/1000000 USD (microdollars)
}

export interface ApiKey {
  id: string;
  user_id: string;
  key_hash: string;
  name?: string;
  expires_at?: Date;
  created_at: Date;
  last_used_at?: Date;
}

export interface UsageRecord {
  id: string;
  user_id: string;
  api_key_id: string;
  amount: number; // in microdollars
  tokens_used?: number;
  model?: string;
  created_at: Date;
}
