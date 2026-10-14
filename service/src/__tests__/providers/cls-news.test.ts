import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  process.env.GOFUND_DB_PATH = ':memory:';
  process.env.LOG_DIR = '/tmp/gofund-test-logs';
});

const mocks = vi.hoisted(() => ({ fetchJson: vi.fn(), fetchText: vi.fn() }));

vi.mock('../../providers/eastmoney/eastmoneyRequest.js', () => ({
  fetchJson: mocks.fetchJson,
  fetchText: mocks.fetchText,
}));

const { ClsNewsProvider, buildClsSignedQuery } = await import(
  '../../providers/eastmoney/eastmoneyNewsProvider.js'
);

/**
 * 财联社快讯：2026-10-10 起 `nodeapi/telegraphList` 变 404，provider 一直在踢熔断日志。
 * 新端点 `v1/roll/get_roll_list` 要签名，算法照抄 akshare `stock_info_global_cls`
 * （`md5(sha1(urlencode(params)))`）—— 这个 hash 一起变就说明和 akshare 的算法对不上了。
 */
describe('财联社快讯（签名接口）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds the same signature as akshare stock_info_global_cls', () => {
    // 对照值由 python 用 akshare 同款写法算出：
    //   md5(sha1(urlencode({'app':'CailianpressWeb','category':'','last_time':1791968535,
    //                       'os':'web','refresh_type':'1','rn':'20','sv':'8.4.6'})))
    const query = buildClsSignedQuery(20, 1791968535_000);
    expect(query).toBe(
      'app=CailianpressWeb&category=&last_time=1791968535&os=web&refresh_type=1&rn=20&sv=8.4.6' +
        '&sign=6a9510f49b39e00b991dbda5bbd7a0ef',
    );
  });

  it('caps rn at 50 because the API silently returns nothing above that', () => {
    // 实测 rn=50 → 50 条；rn=51 → 0 条（不报错）。调用方传的是 count*2。
    expect(buildClsSignedQuery(80, 1791968535_000)).toContain('&rn=50&');
    expect(buildClsSignedQuery(50, 1791968535_000)).toContain('&rn=50&');
    expect(buildClsSignedQuery(20, 1791968535_000)).toContain('&rn=20&');
    expect(buildClsSignedQuery(0, 1791968535_000)).toContain('&rn=1&');
  });

  it('calls the signed endpoint (not the dead nodeapi one)', async () => {
    mocks.fetchJson.mockResolvedValue({ errno: 0, data: { roll_data: [] } });
    await new ClsNewsProvider().flashNews(20);

    const url = String(mocks.fetchJson.mock.calls[0][0]);
    expect(url.startsWith('https://www.cls.cn/v1/roll/get_roll_list?')).toBe(true);
    expect(url).toContain('&sign=');
    expect(url).not.toContain('nodeapi');
  });

  it('maps title/brief/content without duplicating the same text', async () => {
    mocks.fetchJson.mockResolvedValue({
      errno: 0,
      data: {
        roll_data: [
          // 真实样本：title 为空、brief 与 content 是同一段
          { title: '', brief: '财联社10月14日电，摩根大通在百济神州H股…', content: '财联社10月14日电，摩根大通在百济神州H股…', ctime: 1791968523 },
          // 有标题的条目：summary 取 brief
          { title: '【标题】要闻', brief: '简述', content: '<p>正文</p>', ctime: 1791968400 },
          { title: '', brief: '', content: '', ctime: 1791968300 },
        ],
      },
    });

    const { items } = await new ClsNewsProvider().flashNews(20);
    expect(items).toHaveLength(2); // 空条目被过滤
    expect(items[0]).toMatchObject({
      title: '财联社10月14日电，摩根大通在百济神州H股…',
      summary: null,
      source: '财联社',
    });
    expect(items[1]).toMatchObject({ title: '【标题】要闻', summary: '简述' });
    expect(items[0].publishedAt).toBeTruthy();
  });

  it('formats numeric timestamps as Beijing time (UTC string would sink CLS items to the bottom)', async () => {
    // 1791968523 = 2026-10-14 09:02:03 UTC = 2026-10-14 17:02:03 +08:00
    mocks.fetchJson.mockResolvedValue({
      errno: 0,
      data: { roll_data: [{ title: 't', brief: 'b', ctime: 1791968523 }] },
    });
    const { items } = await new ClsNewsProvider().flashNews(20);
    expect(items[0].publishedAt).toBe('2026-10-14 17:02:03');

    // 毫秒时间戳同样处理
    mocks.fetchJson.mockResolvedValue({
      errno: 0,
      data: { roll_data: [{ title: 't', brief: 'b', ctime: 1791968523000 }] },
    });
    const ms = await new ClsNewsProvider().flashNews(20);
    expect(ms.items[0].publishedAt).toBe('2026-10-14 17:02:03');
  });

  it('stays silent (empty items) when the endpoint returns an error payload', async () => {
    mocks.fetchJson.mockResolvedValue({ errno: '10012', msg: '签名错误' });
    const { items } = await new ClsNewsProvider().flashNews(20);
    expect(items).toEqual([]);
  });
});
