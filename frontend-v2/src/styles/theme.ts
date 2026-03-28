import type { ThemeConfig } from 'antd'

export const colors = {
  primary: '#5B3DF5',
  primaryLight: '#E4DFFF',
  background: '#FDFDFD',
  border: '#ECECF3',
  text: '#1F2430',
  textSecondary: '#8F96A3',
  success: '#22C55E',
  error: '#EF4444',
  warning: '#F59E0B',
} as const

export const antdTheme: ThemeConfig = {
  token: {
    colorPrimary: colors.primary,
    colorBgContainer: '#FFFFFF',
    colorBgLayout: colors.background,
    colorBorder: colors.border,
    colorText: colors.text,
    colorTextSecondary: colors.textSecondary,
    borderRadius: 12,
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    controlHeight: 36,
    fontSize: 14,
  },
  components: {
    Button: {
      controlHeight: 36,
      borderRadius: 10,
      fontWeight: 600,
    },
    Input: {
      controlHeight: 36,
      borderRadius: 10,
    },
    Select: {
      controlHeight: 36,
      borderRadius: 10,
    },
    Card: {
      borderRadius: 12,
      boxShadow: 'none',
    },
    Table: {
      borderRadius: 12,
      headerBg: '#FAFAFA',
    },
    Menu: {
      itemBorderRadius: 10,
      itemSelectedBg: '#F0EDFF',
      itemSelectedColor: colors.primary,
    },
  },
}
