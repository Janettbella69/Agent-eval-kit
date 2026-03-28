import { useState } from 'react'
import { Button, Select, DatePicker, Empty, Typography } from 'antd'
import { FilterOutlined, ReloadOutlined } from '@ant-design/icons'
import PageHeader from '../../components/PageHeader'
import TopToast from '../../components/TopToast'

const { Text } = Typography

export default function TracePage() {
  const [showError, setShowError] = useState(true)
  const [filtersExpanded, setFiltersExpanded] = useState(false)

  return (
    <div>
      {showError && (
        <div style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <TopToast message="NetworkError when attempting to fetch resource." onClose={() => setShowError(false)} />
        </div>
      )}

      <PageHeader
        breadcrumbs={[{ label: '观测' }, { label: 'Trace' }]}
        title="Trace"
        subtitle="追踪和分析 Agent 的完整执行过程"
      />

      {/* Filter toolbar */}
      <div style={{
        background: '#fff', borderRadius: 12, border: '1px solid #ECECF3',
        padding: '12px 16px', marginBottom: 24,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button
            icon={<FilterOutlined />}
            onClick={() => setFiltersExpanded(!filtersExpanded)}
            type={filtersExpanded ? 'primary' : 'default'}
            ghost={filtersExpanded}
            style={{ borderRadius: 10 }}
          >
            过滤器
          </Button>
          <Select defaultValue="3d" style={{ width: 140 }} options={[
            { value: '1h', label: '过去 1 小时' },
            { value: '24h', label: '过去 24 小时' },
            { value: '3d', label: '过去 3 天' },
            { value: '7d', label: '过去 7 天' },
            { value: '30d', label: '过去 30 天' },
          ]} />
          <Select defaultValue="all" style={{ width: 140 }} options={[
            { value: 'all', label: 'All Span' },
            { value: 'llm', label: 'LLM Span' },
            { value: 'tool', label: 'Tool Span' },
            { value: 'agent', label: 'Agent Span' },
          ]} />
          <Select defaultValue="prompt" style={{ width: 140 }} options={[
            { value: 'prompt', label: 'Prompt 开发' },
            { value: 'eval', label: '评测' },
            { value: 'production', label: '生产' },
          ]} />
          <div style={{ flex: 1 }} />
          <Button icon={<ReloadOutlined />} style={{ borderRadius: 10 }} />
        </div>

        {/* Expanded filters */}
        {filtersExpanded && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #ECECF3' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 16 }}>
              <div>
                <Text style={{ fontSize: 11, color: '#8F96A3', display: 'block', marginBottom: 4 }}>Trace ID</Text>
                <Select mode="tags" placeholder="输入 Trace ID" style={{ width: '100%' }} />
              </div>
              <div>
                <Text style={{ fontSize: 11, color: '#8F96A3', display: 'block', marginBottom: 4 }}>状态</Text>
                <Select mode="multiple" placeholder="选择状态" style={{ width: '100%' }} options={[
                  { value: 'success', label: 'Success' },
                  { value: 'error', label: 'Error' },
                  { value: 'running', label: 'Running' },
                ]} />
              </div>
              <div>
                <Text style={{ fontSize: 11, color: '#8F96A3', display: 'block', marginBottom: 4 }}>时间范围</Text>
                <DatePicker.RangePicker style={{ width: '100%' }} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button size="small" style={{ borderRadius: 8 }}>重置</Button>
              <Button size="small" type="primary" style={{ borderRadius: 8 }}>应用筛选</Button>
            </div>
          </div>
        )}
      </div>

      {/* Empty state */}
      <div style={{
        background: '#fff', borderRadius: 16, border: '1px dashed #ECECF3',
        padding: '100px 0', textAlign: 'center',
      }}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <div>
              <div style={{ color: '#1F2430', fontWeight: 600, fontSize: 15, marginBottom: 4 }}>暂无数据</div>
              <div style={{ color: '#8F96A3', fontSize: 13 }}>请检查网络连接或调整筛选条件</div>
            </div>
          }
        />
      </div>
    </div>
  )
}
