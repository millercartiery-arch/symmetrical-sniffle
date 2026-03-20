import { useState, useCallback, useEffect } from 'react';

export type SelectionColor = 'red' | 'yellow' | 'green' | 'blue' | 'default';

interface UseSelectionStyleOptions {
  defaultColor?: SelectionColor;
  colorMap?: Record<string, SelectionColor>; // key -> color mapping
}

interface SelectionItem {
  key?: string | number;
  status?: string;
}

/**
 * Hook for handling selection styles with mouse-following U-shaped borders
 */
export const useSelectionStyle = <T extends SelectionItem>(
  items: T[],
  options: UseSelectionStyleOptions = {}
) => {
  const { defaultColor = 'default', colorMap = {} } = options;
  
  const [hoveredKey, setHoveredKey] = useState<string | number | null>(null);
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<(string | number)[]>([]);

  // Get color based on item status
  const getColor = useCallback((item: T): SelectionColor => {
    const status = item.status?.toLowerCase() || '';
    
    // Check custom mapping first
    for (const [key, color] of Object.entries(colorMap)) {
      if (status.includes(key.toLowerCase())) {
        return color;
      }
    }
    
    // Default mappings
    if (status.includes('dead') || status.includes('banned') || status.includes('failed')) {
      return 'red';
    }
    if (status.includes('cooldown') || status.includes('warning') || status.includes('pending')) {
      return 'yellow';
    }
    if (status.includes('ready') || status.includes('active') || status.includes('online') || status.includes('success')) {
      return 'green';
    }
    if (status.includes('sending') || status.includes('progress')) {
      return 'blue';
    }
    
    return defaultColor;
  }, [colorMap, defaultColor]);

  // Handle mouse movement for hover effect
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    setMousePosition({ x: e.clientX, y: e.clientY });
  }, []);

  // Handle mouse enter on item
  const handleMouseEnter = useCallback((key: string | number) => {
    setHoveredKey(key);
  }, []);

  // Handle mouse leave
  const handleMouseLeave = useCallback(() => {
    setHoveredKey(null);
  }, []);

  // Toggle selection
  const toggleSelection = useCallback((key: string | number) => {
    setSelectedKeys(prev => {
      if (prev.includes(key)) {
        return prev.filter(k => k !== key);
      }
      return [...prev, key];
    });
  }, []);

  // Select all
  const selectAll = useCallback(() => {
    setSelectedKeys(items.map(item => item.key ?? (item as any).id ?? item));
  }, [items]);

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedKeys([]);
  }, []);

  // Get CSS class based on item status
  const getSelectionClass = useCallback((item: T): string => {
    const key = item.key ?? (item as any).id;
    if (!key) return '';
    
    const color = getColor(item);
    
    // Check if hovered or selected
    if (hoveredKey === key || selectedKeys.includes(key)) {
      return `selection-${color}`;
    }
    
    return '';
  }, [hoveredKey, selectedKeys, getColor]);

  // Reset when items change
  useEffect(() => {
    setSelectedKeys([]);
    setHoveredKey(null);
  }, [items]);

  return {
    hoveredKey,
    mousePosition,
    selectedKeys,
    setSelectedKeys,
    getColor,
    getSelectionClass,
    handleMouseMove,
    handleMouseEnter,
    handleMouseLeave,
    toggleSelection,
    selectAll,
    clearSelection,
    isSelected: (key: string | number) => selectedKeys.includes(key),
    isHovered: (key: string | number) => hoveredKey === key,
  };
};

/**
 * Hook for confirmation dialogs
 */
export const useConfirmDialog = () => {
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    content: string;
    onConfirm: (() => void) | null;
    type: 'danger' | 'warning' | 'info';
  }>({
    open: false,
    title: '',
    content: '',
    onConfirm: null,
    type: 'danger',
  });

  const showConfirm = useCallback((
    title: string,
    content: string,
    onConfirm: () => void,
    type: 'danger' | 'warning' | 'info' = 'danger'
  ) => {
    setConfirmState({
      open: true,
      title,
      content,
      onConfirm: () => {
        onConfirm();
        setConfirmState(prev => ({ ...prev, open: false }));
      },
      type,
    });
  }, []);

  const closeConfirm = useCallback(() => {
    setConfirmState(prev => ({ ...prev, open: false, onConfirm: null }));
  }, []);

  return {
    ...confirmState,
    showConfirm,
    closeConfirm,
  };
};

export default useSelectionStyle;
