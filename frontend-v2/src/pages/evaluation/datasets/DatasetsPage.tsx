import { Button, Input, Select, Space } from 'antd'
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import PageHeader from '../../../components/PageHeader'

export default function DatasetsPage() {
  const navigate = useNavigate()

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: '评测', path: '/evaluation/datasets' }, { label: '评测集' }]}
        title="评测集"
        subtitle="管理评测数据集和测试用例"
      />

      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Space>
          <Input prefix={<SearchOutlined style={{ color: '#8F96A3' }} />} placeholder="搜索名称..." style={{ width: 220, borderRadius: 10 }} />
          <Select placeholder="创建人" style={{ width: 140 }} allowClear options={[
            { value: 'admin', label: 'Admin' },
            { value: 'system', label: 'System' },
          ]} />
          <Button icon={<ReloadOutlined />} style={{ borderRadius: 10 }} />
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/evaluation/datasets/create')} style={{ borderRadius: 10 }}>
          新建评测集
        </Button>
      </div>

      {/* Empty state */}
      <div style={{
        background: '#fff', borderRadius: 16, border: '1px solid #ECECF3',
        padding: '72px 0', textAlign: 'center',
      }}>
        <div style={{ width: 64, height: 64, borderRadius: 32, background: '#F5F5FA', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: 28 }}>
          📂
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, color: '#1F2430', marginBottom: 8 }}>暂无评测集</div>
        <div style={{ color: '#8F96A3', fontSize: 13, maxWidth: 300, margin: '0 auto 24px' }}>
          评测集用于管理测试用例和 golden data
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/evaluation/datasets/create')} style={{ borderRadius: 10 }}>
          创建第一个评测集
        </Button>
      </div>
    </div>
  )
}
