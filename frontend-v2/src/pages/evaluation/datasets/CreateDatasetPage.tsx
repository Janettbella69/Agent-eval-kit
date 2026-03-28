import { useState } from 'react'
import { Button, Card, Input, Select, Switch, Typography, Space } from 'antd'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import PageHeader from '../../../components/PageHeader'

const { TextArea } = Input
const { Text } = Typography

interface SchemaField {
  id: string
  name: string
  dataType: string
  required: boolean
  description: string
}

const INITIAL_FIELDS: SchemaField[] = [
  { id: '1', name: 'input', dataType: 'string', required: true, description: '用户输入的查询内容' },
  { id: '2', name: 'reference_output', dataType: 'string', required: false, description: '参考输出（golden data）' },
]

function SchemaFieldCard({ field, onChange, onDelete }: {
  field: SchemaField; onChange: (f: SchemaField) => void; onDelete: () => void
}) {
  return (
    <Card size="small" style={{ borderRadius: 12, border: '1px solid #ECECF3', marginBottom: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px 60px 1fr auto', gap: 12, alignItems: 'center' }}>
        <div>
          <Text style={{ fontSize: 11, color: '#8F96A3', display: 'block', marginBottom: 4 }}>名称</Text>
          <Input size="small" value={field.name} onChange={e => onChange({ ...field, name: e.target.value })} style={{ borderRadius: 8 }} />
        </div>
        <div>
          <Text style={{ fontSize: 11, color: '#8F96A3', display: 'block', marginBottom: 4 }}>数据类型</Text>
          <Select size="small" value={field.dataType} onChange={v => onChange({ ...field, dataType: v })} style={{ width: '100%' }} options={[
            { value: 'string', label: 'String' },
            { value: 'number', label: 'Number' },
            { value: 'boolean', label: 'Boolean' },
            { value: 'json', label: 'JSON' },
            { value: 'array', label: 'Array' },
          ]} />
        </div>
        <div style={{ textAlign: 'center' }}>
          <Text style={{ fontSize: 11, color: '#8F96A3', display: 'block', marginBottom: 4 }}>Required</Text>
          <Switch size="small" checked={field.required} onChange={v => onChange({ ...field, required: v })} />
        </div>
        <div>
          <Text style={{ fontSize: 11, color: '#8F96A3', display: 'block', marginBottom: 4 }}>描述</Text>
          <Input size="small" value={field.description} onChange={e => onChange({ ...field, description: e.target.value })} style={{ borderRadius: 8 }} />
        </div>
        <Button type="text" size="small" icon={<DeleteOutlined />} danger onClick={onDelete} style={{ marginTop: 18 }} />
      </div>
    </Card>
  )
}

export default function CreateDatasetPage() {
  const [fields, setFields] = useState<SchemaField[]>(INITIAL_FIELDS)

  return (
    <div style={{ maxWidth: 960 }}>
      <PageHeader
        breadcrumbs={[{ label: '评测', path: '/evaluation/datasets' }, { label: '评测集', path: '/evaluation/datasets' }, { label: '新建评测集' }]}
        title="新建评测集"
      />

      {/* Basic info */}
      <Card style={{ borderRadius: 12, border: '1px solid #ECECF3', marginBottom: 24 }}>
        <Text strong style={{ fontSize: 15, display: 'block', marginBottom: 16 }}>基本信息</Text>
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          <div>
            <Text style={{ fontSize: 12, color: '#8F96A3', display: 'block', marginBottom: 6 }}>名称</Text>
            <Input placeholder="例如：Shopping Research V1" style={{ borderRadius: 10 }} />
          </div>
          <div>
            <Text style={{ fontSize: 12, color: '#8F96A3', display: 'block', marginBottom: 6 }}>描述</Text>
            <TextArea placeholder="描述这个评测集的用途..." rows={2} style={{ borderRadius: 10 }} />
          </div>
        </Space>
      </Card>

      {/* Schema fields */}
      <Card style={{ borderRadius: 12, border: '1px solid #ECECF3' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Text strong style={{ fontSize: 15 }}>配置列</Text>
          <Text style={{ fontSize: 12, color: '#8F96A3' }}>{fields.length} 个字段</Text>
        </div>

        {fields.map((f, i) => (
          <SchemaFieldCard
            key={f.id}
            field={f}
            onChange={updated => setFields(fields.map((ff, ii) => ii === i ? updated : ff))}
            onDelete={() => setFields(fields.filter((_, ii) => ii !== i))}
          />
        ))}

        <Button type="dashed" block icon={<PlusOutlined />} onClick={() => setFields([...fields, {
          id: Date.now().toString(), name: '', dataType: 'string', required: false, description: '',
        }])} style={{ borderRadius: 10, height: 40 }}>
          添加字段
        </Button>
      </Card>

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24, paddingBottom: 40 }}>
        <Button type="primary" size="large" style={{ borderRadius: 10, minWidth: 120 }}>创建</Button>
      </div>
    </div>
  )
}
