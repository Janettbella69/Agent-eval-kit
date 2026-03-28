import { Outlet } from 'react-router-dom'
import SidebarNav from '../components/SidebarNav'

export default function AppShell() {
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <SidebarNav />
      <main style={{ marginLeft: 220, flex: 1, padding: '24px 32px', maxWidth: 1400 }}>
        <Outlet />
      </main>
    </div>
  )
}
