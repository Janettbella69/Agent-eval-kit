import { Alert } from 'antd'

interface TopToastProps {
  message: string
  type?: 'error' | 'warning' | 'info'
  onClose?: () => void
}

export default function TopToast({ message, type = 'error', onClose }: TopToastProps) {
  return (
    <div style={{
      position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)',
      zIndex: 1000, minWidth: 360, maxWidth: 600,
    }}>
      <Alert
        message={message}
        type={type}
        showIcon
        closable={!!onClose}
        onClose={onClose}
        style={{
          borderRadius: 12,
          boxShadow: '0 8px 32px rgba(31,36,48,0.08)',
          border: type === 'error' ? '1px solid #FCA5A5' : undefined,
        }}
      />
    </div>
  )
}
