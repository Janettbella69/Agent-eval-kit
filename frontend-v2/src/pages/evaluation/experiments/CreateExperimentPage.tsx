import { useState } from 'react'
import { Button, Card, Input, InputNumber, Steps, Typography, Space } from 'antd'
import PageHeader from '../../../components/PageHeader'
import TopToast from '../../../components/TopToast'

const { TextArea } = Input
const { Text } = Typography

export default function CreateExperimentPage() {
  const [current, setCurrent] = useState(0)
  const [showError, setShowError] = useState(true)

  return (
    <div style={{ maxWidth: 960 }}>
      {showError && <TopToast message="NetworkError when attempting to fetch resource." onClose={() => setShowError(false)} />}

      <PageHeader
        breadcrumbs={[
          { label: '评测', path: '/evaluation/experiments/create' },
          { label: '实验', path: '/evaluation/experiments/create' },
          { label: '新建实验' },
        ]}
        title="新建实验"
      />

      {/* Stepper */}
      <Card style={{ borderRadius: 12, border: '1px solid #ECECF3', marginBottom: 24, padding: '8px 0' }}>
        <Steps
          current={current}
          onChange={setCurrent}
          items={[
            { title: '基础信息' },
            { title: '评测集' },
            { title: '评测对象', description: '可选' },
            { title: '评估器', description: '可选' },
          ]}
          style={{ padding: '0 40px' }}
        />
      </Card>

      {/* Step 1: Basic Info */}
      {current === 0 && (
        <Card style={{ borderRadius: 12, border: '1px solid #ECECF3' }}>
          <Text strong style={{ fontSize: 15, display: 'block', marginBottom: 20 }}>基础信息</Text>
          <Space direction="vertical" style={{ width: '100%' }} size={20}>
            <div>
              <Text style={{ fontSize: 12, color: '#8F96A3', display: 'block', marginBottom: 6 }}>名称</Text>
              <Input placeholder="例如：regression-test-20260328" style={{ borderRadius: 10 }} />
            </div>
            <div>
              <Text style={{ fontSize: 12, color: '#8F96A3', display: 'block', marginBottom: 6 }}>描述</Text>
              <TextArea placeholder="实验目的和期望结果..." rows={3} style={{ borderRadius: 10 }} />
            </div>
            <div>
              <Text style={{ fontSize: 12, color: '#8F96A3', display: 'block', marginBottom: 6 }}>最大并发执行条数</Text>
              <InputNumber defaultValue={2} min={1} max={10} style={{ width: 200, borderRadius: 10 }} />
            </div>
          </Space>
        </Card>
      )}

      {current === 1 && (
        <Card style={{ borderRadius: 12, border: '1px solid #ECECF3', padding: '60px 0', textAlign: 'center' }}>
          <Text style={{ color: '#8F96A3' }}>选择评测集（第 2 步）</Text>
        </Card>
      )}

      {current === 2 && (
        <Card style={{ borderRadius: 12, border: '1px solid #ECECF3', padding: '60px 0', textAlign: 'center' }}>
          <Text style={{ color: '#8F96A3' }}>配置评测对象（第 3 步，可选）</Text>
        </Card>
      )}

      {current === 3 && (
        <Card style={{ borderRadius: 12, border: '1px solid #ECECF3', padding: '60px 0', textAlign: 'center' }}>
          <Text style={{ color: '#8F96A3' }}>选择评估器（第 4 步，可选）</Text>
        </Card>
      )}

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24, paddingBottom: 40 }}>
        {current > 0 && (
          <Button style={{ borderRadius: 10 }} onClick={() => setCurrent(current - 1)}>上一步</Button>
        )}
        {current < 3 ? (
          <Button type="primary" size="large" style={{ borderRadius: 10, minWidth: 160 }} onClick={() => setCurrent(current + 1)}>
            下一步：{['评测集', '评测对象', '评估器', ''][current + 1]}
          </Button>
        ) : (
          <Button type="primary" size="large" style={{ borderRadius: 10, minWidth: 120 }}>创建实验</Button>
        )}
      </div>
    </div>
  )
}
