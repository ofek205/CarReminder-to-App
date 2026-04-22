import { QueryClient } from '@tanstack/react-query';


export const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: 1,
			staleTime: 5 * 60 * 1000, // 5 minutes. prevents redundant refetches
			gcTime: 10 * 60 * 1000,   // 10 minutes cache retention
		},
	},
});