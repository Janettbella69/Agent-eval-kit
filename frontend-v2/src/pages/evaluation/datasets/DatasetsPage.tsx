import { Button, Input, Select, Space, Empty } from 'antd'
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
        background: '#fff', borderRadius: 16, border: '1px dashed #ECECF3',
        padding: '80px 0', textAlign: 'center',
      }}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={<span style={{ color: '#8F96A3' }}>暂无评测集，点击右上角创建第一个</span>}
        />
      </div>
    </div>
  )
}
