import { useState } from 'react'
import { Button, Card, Input, Select, Typography, Space } from 'antd'
import { ClearOutlined, FileTextOutlined, BugOutlined } from '@ant-design/icons'
import PageHeader from '../../../components/PageHeader'
import TopToast from '../../../components/TopToast'

const { TextArea } = Input
const { Text } = Typography

export default function CreateEvaluatorPage() {
  const [showError, setShowError] = useState(true)
  const [prompt, setPrompt] = useState(`You are an eval judge for a shopping research guide.

## Task
Evaluate the guide against specific criteria. Determine: PASS or FAIL.

## PASS Definition
Guide addresses requirements with specific evidence (product names, specs, prices, source citations).

## FAIL Definition
Guide misses key requirements or provides only vague/generic content.

## Output
Respond with JSON: {"result": "Pass" or "Fail", "reasoning": "..."}`)

  return (
    <div style={{ maxWidth: 960 }}>
      {showError && <TopToast message="NetworkError when attempting to fetch resource." onClose={() => setShowError(false)} />}

      <PageHeader
        breadcrumbs={[
          { label: '评测', path: '/evaluation/evaluators' },
          { label: '评估器', path: '/evaluation/evaluators' },
          { label: '新建评估器' },
        ]}
        title="新建评估器"
      />

      {/* Basic info */}
      <Card style={{ borderRadius: 12, border: '1px solid #ECECF3', marginBottom: 24 }}>
        <Text strong style={{ fontSize: 15, display: 'block', marginBottom: 16 }}>基础信息</Text>
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          <div>
            <Text style={{ fontSize: 12, color: '#8F96A3', display: 'block', marginBottom: 6 }}>名称</Text>
            <Input placeholder="例如：actionability_judge" style={{ borderRadius: 10 }} />
          </div>
          <div>
            <Text style={{ fontSize: 12, color: '#8F96A3', display: 'block', marginBottom: 6 }}>描述</Text>
            <TextArea placeholder="评估器的用途描述..." rows={2} style={{ borderRadius: 10 }} />
          </div>
        </Space>
      </Card>

      {/* Config */}
      <Card style={{ borderRadius: 12, border: '1px solid #ECECF3' }}>
        <Text strong style={{ fontSize: 15, display: 'block', marginBottom: 16 }}>配置信息</Text>

        <div style={{ marginBottom: 20 }}>
          <Text style={{ fontSize: 12, color: '#8F96A3', display: 'block', marginBottom: 6 }}>模型选择</Text>
          <Select defaultValue="gpt-5.4" style={{ width: 300 }} options={[
            { value: 'gpt-5.4', label: 'GPT-5.4 (OpenAI)' },
            { value: 'claude-opus-4-6', label: 'Claude Opus 4.6 (Anthropic)' },
            { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Anthropic)' },
            { value: 'minimax-m2.7', label: 'MiniMax M2.7' },
          ]} />
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text style={{ fontSize: 12, color: '#8F96A3' }}>Prompt</Text>
            <Space size={4}>
              <Button size="small" type="text" icon={<FileTextOutlined />} style={{ fontSize: 12 }}>选择模板</Button>
              <Button size="small" type="text" icon={<ClearOutlined />} danger style={{ fontSize: 12 }} onClick={() => setPrompt('')}>清空</Button>
            </Space>
          </div>
          <TextArea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={14}
            style={{ borderRadius: 10, fontFamily: "'SF Mono', 'Fira Code', monospace", fontSize: 13, lineHeight: 1.7 }}
          />
        </div>
      </Card>

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24, paddingBottom: 40 }}>
        <Button icon={<BugOutlined />} style={{ borderRadius: 10 }}>调试</Button>
        <Button type="primary" size="large" style={{ borderRadius: 10, minWidth: 120 }}>创建</Button>
      </div>
    </div>
  )
}
