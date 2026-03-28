import { Menu, Typography } from 'antd'
import {
  ExperimentOutlined,
  DatabaseOutlined,
  DashboardOutlined,
  AimOutlined,
  NodeIndexOutlined,
  TagsOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import { useNavigate, useLocation } from 'react-router-dom'

const { Text } = Typography

const menuItems = [
  {
    type: 'group' as const,
    label: 'Prompt 工程',
    key: 'prompt',
    children: [
      { key: '/playground', icon: <ExperimentOutlined />, label: 'Playground' },
    ],
  },
  {
    type: 'group' as const,
    label: '评测',
    key: 'eval',
    children: [
      { key: '/evaluation/datasets', icon: <DatabaseOutlined />, label: '评测集' },
      { key: '/evaluation/evaluators', icon: <DashboardOutlined />, label: '评估器' },
      { key: '/evaluation/experiments/create', icon: <AimOutlined />, label: '实验' },
    ],
  },
  {
    type: 'group' as const,
    label: '观测',
    key: 'observe',
    children: [
      { key: '/observation/trace', icon: <NodeIndexOutlined />, label: 'Trace' },
      { key: '/tags', icon: <TagsOutlined />, label: '标签管理' },
    ],
  },
]

export default function SidebarNav() {
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <aside style={{
      width: 220, height: '100vh', position: 'fixed', left: 0, top: 0,
      background: '#FAFAFE', borderRight: '1px solid #ECECF3',
      display: 'flex', flexDirection: 'column', zIndex: 50,
    }}>
      {/* Logo */}
      <div style={{ padding: '20px 20px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 10, background: '#5B3DF5',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontWeight: 800, fontSize: 14, fontFamily: 'Manrope',
        }}>A</div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1F2430', fontFamily: 'Manrope', lineHeight: 1.2 }}>
            Azora Eval
          </div>
          <Text style={{ fontSize: 9, color: '#8F96A3', letterSpacing: '0.1em', textTransform: 'uppercase' as const }}>
            Workbench
          </Text>
        </div>
      </div>

      {/* Nav */}
      <div className="sidebar-nav" style={{ flex: 1, overflowY: 'auto', padding: '0 4px' }}>
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ border: 'none', background: 'transparent' }}
        />
      </div>

      {/* Footer */}
      <div style={{ padding: '12px 20px', borderTop: '1px solid #ECECF3' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SettingOutlined style={{ color: '#8F96A3', fontSize: 14 }} />
          <Text style={{ fontSize: 12, color: '#8F96A3' }}>设置</Text>
        </div>
      </div>
    </aside>
  )
}
