import { useState } from 'react'
import { Button, Input, Select, Card, Typography, Space, Tag, InputNumber } from 'antd'
import { PlusOutlined, DeleteOutlined, HolderOutlined, SendOutlined, SwapOutlined, ThunderboltOutlined } from '@ant-design/icons'
import PageHeader from '../../components/PageHeader'
import { DndContext, closestCenter } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const { TextArea } = Input
const { Text } = Typography

interface PromptMessage {
  id: string
  role: 'system' | 'user' | 'assistant'
  content: string
}

const INITIAL_MESSAGES: PromptMessage[] = [
  { id: '1', role: 'system', content: 'You are a helpful shopping research assistant. You help users find the best products based on their needs, budget, and preferences.' },
  { id: '2', role: 'system', content: 'When comparing products, always include: price, key specs, pros/cons, and purchase links. Use credible review sources like RTINGS, Wirecutter, and Tom\'s Hardware.' },
]

function SortableMessageCard({ msg, selected, onSelect, onChange, onDelete }: {
  msg: PromptMessage; selected: boolean; onSelect: () => void
  onChange: (content: string) => void; onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: msg.id })
  const style = { transform: CSS.Transform.toString(transform), transition }

  return (
    <div ref={setNodeRef} style={style}>
      <Card
        size="small"
        onClick={onSelect}
        style={{
          borderRadius: 12, marginBottom: 12, cursor: 'pointer',
          border: selected ? '2px solid #5B3DF5' : '1px solid #ECECF3',
          boxShadow: selected ? '0 0 0 3px rgba(91,61,245,0.08)' : 'none',
        }}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span {...attributes} {...listeners} style={{ cursor: 'grab', color: '#C0C0C0' }}>
              <HolderOutlined />
            </span>
            <Tag color={msg.role === 'system' ? 'purple' : msg.role === 'user' ? 'blue' : 'green'} style={{ borderRadius: 6 }}>
              {msg.role}
            </Tag>
          </div>
        }
        extra={
          <Button type="text" size="small" icon={<DeleteOutlined />} danger onClick={e => { e.stopPropagation(); onDelete() }} />
        }
      >
        <TextArea
          value={msg.content}
          onChange={e => onChange(e.target.value)}
          autoSize={{ minRows: 2, maxRows: 8 }}
          variant="borderless"
          style={{ fontSize: 13, color: '#1F2430', padding: 0 }}
          placeholder="输入消息内容..."
        />
      </Card>
    </div>
  )
}

export default function PlaygroundPage() {
  const [messages, setMessages] = useState<PromptMessage[]>(INITIAL_MESSAGES)
  const [selectedId, setSelectedId] = useState('1')
  const [previewText, setPreviewText] = useState('')
  const [userInput, setUserInput] = useState('best noise cancelling headphones under $200')

  const handleDragEnd = (event: { active: { id: string | number }; over: { id: string | number } | null }) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = messages.findIndex(m => m.id === String(active.id))
    const newIndex = messages.findIndex(m => m.id === String(over.id))
    setMessages(arrayMove(messages, oldIndex, newIndex))
  }

  const addMessage = () => {
    setMessages([...messages, { id: Date.now().toString(), role: 'user', content: '' }])
  }

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Prompt 工程' }, { label: 'Playground' }]}
        title="Playground"
        subtitle="草稿已自动保存于 03:39:07"
        extra={
          <Space>
            <Button icon={<SwapOutlined />}>进入对比模式</Button>
            <Button type="primary" icon={<ThunderboltOutlined />}>快捷创建</Button>
          </Space>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(760px, 1fr) 360px', gap: 24 }}>
        {/* Left: Editor */}
        <div>
          <Card style={{ borderRadius: 12, border: '1px solid #ECECF3' }} bodyStyle={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text strong style={{ fontSize: 15 }}>Prompt 模板</Text>
              <Tag>{messages.length} messages</Tag>
            </div>

            <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={messages.map(m => m.id)} strategy={verticalListSortingStrategy}>
                {messages.map(msg => (
                  <SortableMessageCard
                    key={msg.id}
                    msg={msg}
                    selected={selectedId === msg.id}
                    onSelect={() => setSelectedId(msg.id)}
                    onChange={content => setMessages(messages.map(m => m.id === msg.id ? { ...m, content } : m))}
                    onDelete={() => setMessages(messages.filter(m => m.id !== msg.id))}
                  />
                ))}
              </SortableContext>
            </DndContext>

            <Button type="dashed" block icon={<PlusOutlined />} onClick={addMessage} style={{ borderRadius: 10, height: 40 }}>
              添加消息
            </Button>
          </Card>

          {/* Model Config */}
          <Card style={{ borderRadius: 12, border: '1px solid #ECECF3', marginTop: 16 }} bodyStyle={{ padding: 20 }}>
            <Text strong style={{ fontSize: 15, display: 'block', marginBottom: 16 }}>模型配置</Text>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <Text style={{ fontSize: 12, color: '#8F96A3', display: 'block', marginBottom: 6 }}>模型</Text>
                <Select defaultValue="claude-sonnet-4-6" style={{ width: '100%' }} options={[
                  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
                  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
                  { value: 'gpt-5.4', label: 'GPT-5.4' },
                  { value: 'minimax-m2.7', label: 'MiniMax M2.7' },
                ]} />
              </div>
              <div>
                <Text style={{ fontSize: 12, color: '#8F96A3', display: 'block', marginBottom: 6 }}>Temperature</Text>
                <InputNumber defaultValue={0.7} min={0} max={2} step={0.1} style={{ width: '100%' }} />
              </div>
              <div>
                <Text style={{ fontSize: 12, color: '#8F96A3', display: 'block', marginBottom: 6 }}>Max Tokens</Text>
                <InputNumber defaultValue={4096} min={1} max={128000} style={{ width: '100%' }} />
              </div>
              <div>
                <Text style={{ fontSize: 12, color: '#8F96A3', display: 'block', marginBottom: 6 }}>Top P</Text>
                <InputNumber defaultValue={1} min={0} max={1} step={0.05} style={{ width: '100%' }} />
              </div>
            </div>
          </Card>
        </div>

        {/* Right: Preview */}
        <div>
          <Card style={{ borderRadius: 12, border: '1px solid #ECECF3', position: 'sticky', top: 24 }} bodyStyle={{ padding: 20, display: 'flex', flexDirection: 'column', height: 'calc(100vh - 180px)' }}>
            <Text strong style={{ fontSize: 15, display: 'block', marginBottom: 16 }}>预览与调试</Text>
            <div style={{ flex: 1, overflowY: 'auto', padding: 12, background: '#FAFAFE', borderRadius: 10, marginBottom: 16, fontSize: 13, color: '#8F96A3', lineHeight: 1.8 }}>
              {previewText || '运行后在此查看模型输出...'}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Input
                value={userInput}
                onChange={e => setUserInput(e.target.value)}
                placeholder="输入测试内容..."
                style={{ borderRadius: 10 }}
                onPressEnter={() => setPreviewText('正在生成...')}
              />
              <Button type="primary" icon={<SendOutlined />} onClick={() => setPreviewText('正在生成...')} style={{ borderRadius: 10 }}>
                运行
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
