import React from 'react';
import { Modal, Space, Radio, Button, Checkbox, Row, Col } from 'antd';

type Props = {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  exportFormat: 'json' | 'csv';
  setExportFormat: (v: 'json' | 'csv') => void;
  selectedExportFields: string[];
  setSelectedExportFields: (v: string[]) => void;
  allFieldOptions: string[];
  presetFields: string[];
  accountsCount: number;
};

const ExportFieldsModal: React.FC<Props> = ({
  open,
  onCancel,
  onConfirm,
  exportFormat,
  setExportFormat,
  selectedExportFields,
  setSelectedExportFields,
  allFieldOptions,
  presetFields,
  accountsCount,
}) => {
  return (
    <Modal title="自定义字段导出" open={open} onCancel={onCancel} onOk={onConfirm} okText="导出" cancelText="取消" width={720}>
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <div>
          <span style={{ fontWeight: 600 }}>格式</span>
          <div style={{ marginTop: 8 }}>
            <Radio.Group value={exportFormat} onChange={(e) => setExportFormat(e.target.value)}>
              <Radio.Button value="json">JSON</Radio.Button>
              <Radio.Button value="csv">CSV</Radio.Button>
            </Radio.Group>
          </div>
        </div>
        <div>
          <Space style={{ marginBottom: 8 }}>
            <span style={{ fontWeight: 600 }}>字段</span>
            <Button size="small" onClick={() => setSelectedExportFields(allFieldOptions)}>
              全选
            </Button>
            <Button size="small" onClick={() => setSelectedExportFields([])}>
              清空
            </Button>
            <Button size="small" onClick={() => setSelectedExportFields(presetFields.filter((f) => allFieldOptions.includes(f)))}>
              默认
            </Button>
          </Space>
          <Checkbox.Group value={selectedExportFields} onChange={(vals) => setSelectedExportFields(vals as string[])} style={{ width: '100%' }}>
            <Row gutter={[8, 8]}>
              {allFieldOptions.map((field) => (
                <Col span={8} key={field}>
                  <Checkbox value={field}>{field}</Checkbox>
                </Col>
              ))}
            </Row>
          </Checkbox.Group>
        </div>
        <span style={{ color: '#8c8c8c' }}>将导出当前列表数据，共 {accountsCount} 条，已选字段 {selectedExportFields.length} 个。</span>
      </Space>
    </Modal>
  );
};

export default ExportFieldsModal;

