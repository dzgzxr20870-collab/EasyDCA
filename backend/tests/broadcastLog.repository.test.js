// Mock Supabase Client เป็น Query Builder แบบ Chainable — insert/select คืน query เดิม
// ส่วน single เป็น Terminal ที่ Resolve เป็น { data, error } เหมือน PostgREST จริง
jest.mock('../src/config/supabase', () => {
  const query = {};
  query.insert = jest.fn(() => query);
  query.select = jest.fn(() => query);
  query.single = jest.fn();
  const supabaseAdmin = { from: jest.fn(() => query) };
  return { supabaseAdmin, __query: query };
});

const { supabaseAdmin, __query } = require('../src/config/supabase');
const broadcastLogRepository = require('../src/repositories/broadcastLog.repository');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('broadcastLog.repository.create', () => {
  test('Insert แบบ snake_case แล้ว map กลับเป็น camelCase (toBroadcastLog)', async () => {
    __query.single.mockResolvedValue({
      data: {
        id: 'bc-1',
        sent_by: 'Uadmin1',
        target_group: 'free',
        message_type: 'promotion',
        message_content: 'ลด 50%!',
        total_recipients: 3,
        success_count: 2,
        failure_count: 1,
        created_at: '2026-07-09T00:00:00.000Z',
      },
      error: null,
    });

    const result = await broadcastLogRepository.create({
      sentBy: 'Uadmin1',
      targetGroup: 'free',
      messageType: 'promotion',
      messageContent: 'ลด 50%!',
      totalRecipients: 3,
      successCount: 2,
      failureCount: 1,
    });

    expect(supabaseAdmin.from).toHaveBeenCalledWith('broadcast_logs');
    expect(__query.insert).toHaveBeenCalledWith({
      sent_by: 'Uadmin1',
      target_group: 'free',
      message_type: 'promotion',
      message_content: 'ลด 50%!',
      total_recipients: 3,
      success_count: 2,
      failure_count: 1,
    });
    expect(result).toMatchObject({
      id: 'bc-1',
      sentBy: 'Uadmin1',
      targetGroup: 'free',
      messageType: 'promotion',
      totalRecipients: 3,
      successCount: 2,
      failureCount: 1,
    });
  });

  test('DB error → throw', async () => {
    __query.single.mockResolvedValue({ data: null, error: { message: 'db down' } });

    await expect(
      broadcastLogRepository.create({
        sentBy: 'Uadmin1',
        targetGroup: 'all',
        messageType: 'news',
        messageContent: 'x',
        totalRecipients: 0,
        successCount: 0,
        failureCount: 0,
      })
    ).rejects.toThrow('db down');
  });
});
