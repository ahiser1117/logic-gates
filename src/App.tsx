import { useEffect } from 'react'
import { Layout } from './components/Layout'
import { useStore } from './store'

export default function App() {
  const loadCustomComponents = useStore((s) => s.loadCustomComponents)

  useEffect(() => {
    loadCustomComponents()
  }, [loadCustomComponents])

  return <Layout />
}
