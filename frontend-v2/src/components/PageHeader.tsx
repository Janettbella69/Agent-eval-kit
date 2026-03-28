import { Breadcrumb, Typography } from 'antd'
import { Link } from 'react-router-dom'

const { Title, Text } = Typography

interface BreadcrumbItem {
  label: string
  path?: string
}

interface PageHeaderProps {
  breadcrumbs: BreadcrumbItem[]
  title: string
  subtitle?: string
  extra?: React.ReactNode
}

export default function PageHeader({ breadcrumbs, title, subtitle, extra }: PageHeaderProps) {
  return (
    <div style={{ marginBottom: 32 }}>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={breadcrumbs.map(b => ({
          title: b.path ? <Link to={b.path} style={{ color: '#8F96A3' }}>{b.label}</Link> : <span style={{ color: '#8F96A3' }}>{b.label}</span>,
        }))}
      />
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <Title level={2} className="headline-font" style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', color: '#1F2430' }}>
            {title}
          </Title>
          {subtitle && (
            <Text style={{ color: '#8F96A3', fontSize: 14, marginTop: 4, display: 'block' }}>{subtitle}</Text>
          )}
        </div>
        {extra && <div>{extra}</div>}
      </div>
    </div>
  )
}
