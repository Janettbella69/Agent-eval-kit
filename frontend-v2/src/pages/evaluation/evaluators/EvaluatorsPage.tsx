import { useState } from 'react'
import { Button, Input, Space, Empty } from 'antd'
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

      <div style={{
        background: '#fff', borderRadius: 16, border: '1px dashed #ECECF3',
        padding: '80px 0', textAlign: 'center',
      }}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={<span style={{ color: '#8F96A3' }}>暂无评估器数据</span>}
        >
          <div style={{ color: '#8F96A3', fontSize: 13, marginBottom: 16 }}>
            由于网络请求失败，我们无法加载现有的评估器列表
          </div>
          <Space>
            <Button style={{ borderRadius: 10 }}>查看文档</Button>
            <Button type="primary" ghost style={{ borderRadius: 10 }} onClick={() => setShowError(false)}>重试加载</Button>
          </Space>
        </Empty>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, marginTop: 32 }}>
        {[
          { label: '活跃评估器', value: '--' },
          { label: '平均准确率', value: '--' },
          { label: '总评估次数', value: '--' },
          { label: '状态', value: '连接异常', accent: true },
        ].map(s => (
          <div key={s.label} style={{
            padding: 20, background: '#FAFAFE', borderRadius: 14,
            borderLeft: s.accent ? '4px solid rgba(91,61,245,0.3)' : undefined,
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: s.accent ? '#5B3DF5' : '#8F96A3', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
              {s.label}
            </div>
            <div className="headline-font" style={{ fontSize: 26, fontWeight: 700, color: s.accent ? '#EF4444' : '#1F2430' }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
