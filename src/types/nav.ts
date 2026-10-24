export type Route = 'today' | 'train' | 'plan' | 'food' | 'coach' | 'me';

export const ROUTES: readonly Route[] = ['today', 'train', 'plan', 'food', 'coach', 'me'] as const;
