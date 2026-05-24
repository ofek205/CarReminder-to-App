import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';
import { reportUserError } from './crashReporter';

export const queryClientInstance = new QueryClient({
	queryCache: new QueryCache({
		onError: (error, query) => {
			reportUserError('query_failed', error, {
				queryKey: JSON.stringify(query.queryKey).slice(0, 200),
			});
		},
	}),
	mutationCache: new MutationCache({
		onError: (error, variables, _context, mutation) => {
			reportUserError('mutation_failed', error, {
				mutationKey: mutation.options.mutationKey
					? JSON.stringify(mutation.options.mutationKey).slice(0, 200)
					: undefined,
			});
		},
	}),
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: 1,
			staleTime: 5 * 60 * 1000,
			gcTime: 10 * 60 * 1000,
		},
	},
});