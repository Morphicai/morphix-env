import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { App } from '@/App'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // names/status 只在内存中短期复用；绝不使用 persistQueryClient。
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
    mutations: { retry: 0 },
  },
})

const root = document.getElementById('root')
if (!root) throw new Error('Panel root is missing')

createRoot(root).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
)
