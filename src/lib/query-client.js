import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';
import { reportError, reportUserError } from './crashReporter';

export const queryClientInstance = new QueryClient({
	queryCache: new QueryCache({
		onError: (error, query) => {
			// Log query failures for diagnostics but do NOT mark them
			// visible — the user sees a loading/error boundary state,
			// not the raw error text. reportUserError set visible:true,
			// which was triggering user_visible_error_spike alerts for
			// every transient Supabase/network hiccup. Only explicit
			// toastError calls (user_visible type) should be visible.
			reportError('query_failed', error, {
				visible: false,
				action: 'query_failed',
				queryKey: JSON.stringify(query.queryKey).slice(0, 200),
			});
		},
	}),
	mutationCache: new MutationCache({
		onError: (error, variables, _context, mutation) => {
			// Mutations that fail are generally user-visible (the user
			// clicked save/delete and it didn't work), so keep visible.
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