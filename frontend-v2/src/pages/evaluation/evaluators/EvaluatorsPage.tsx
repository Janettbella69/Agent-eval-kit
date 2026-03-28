import { useState } from 'react'
import { Button, Input, Space } from 'antd'
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import PageHeader from '../../../components/PageHeader'
import TopToast from '../../../components/TopToast'

export default function EvaluatorsPage() {
  const navigate = useNavigate()
  const [showError, setShowError] = useState(true)

  return (
    <div>
      {showError && <TopToast message="NetworkError when attempting to fetch resource." onClose={() => setShowError(false)} />}

      <PageHeader
        breadcrumbs={[{ label: '评测', path: '/evaluation/evaluators' }, { label: '评估器' }]}
        title="评估器"
        subtitle="通过自动化指标和人工反馈来量化模型性能"
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Space>
          <Input prefix={<SearchOutlined style={{ color: '#8F96A3' }} />} placeholder="搜索评估器..." style={{ width: 220, borderRadius: 10 }} />
          <Button icon={<ReloadOutlined />} style={{ borderRadius: 10 }} />
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/evaluation/evaluators/create')} style={{ borderRadius: 10 }}>
          新建评估器
        </Button>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 }}>
        {[
          { label: '评估器', value: '4' },
          { label: '准确率', value: '72.5%' },
          { label: '评估次数', value: '154' },
          { label: '通过率', value: '14%', accent: true },
        ].map(s => (
          <div key={s.label} style={{
            padding: '20px 24px', background: '#fff', borderRadius: 16,
            border: '1px solid #ECECF3',
            borderLeft: s.accent ? '3px solid #5B3DF5' : '1px solid #ECECF3',
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: s.accent ? '#5B3DF5' : '#8F96A3', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
              {s.label}
            </div>
            <div className="headline-font" style={{ fontSize: 28, fontWeight: 700, color: '#1F2430', letterSpacing: '-0.02em' }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Empty state */}
      <div style={{
        background: '#fff', borderRadius: 16, border: '1px solid #ECECF3',
        padding: '72px 0', textAlign: 'center',
      }}>
        <div style={{ width: 64, height: 64, borderRadius: 32, background: '#F5F5FA', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: 28, color: '#C0C0D0' }}>
          📋
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, color: '#1F2430', marginBottom: 8 }}>暂无评估器数据</div>
        <div style={{ color: '#8F96A3', fontSize: 13, marginBottom: 24, maxWidth: 320, margin: '0 auto 24px' }}>
          点击上方「新建评估器」创建你的第一个自动化评估器
        </div>
        <Space>
          <Button style={{ borderRadius: 10 }}>查看文档</Button>
          <Button type="primary" style={{ borderRadius: 10 }}>新建评估器</Button>
        </Space>
      </div>
    </div>
  )
}
