import { I18nProvider } from '@heroui/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/globals.css'

const queryClient = new QueryClient()

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')
createRoot(root).render(
  <I18nProvider locale="zh-CN">
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </I18nProvider>,
)
