import { addMakerRepositories, vendorPushMetaData } from './vendor-push-plugin';

describe('vendor push build settings', () => {
  it('writes only the configured makers, keeping long numeric ids as text', () => {
    expect(
      vendorPushMetaData({
        huaweiAppId: '104000001',
        vivoApiKey: 'abc',
        vivoAppId: '105000002',
        xiaomiAppId: '2882303761520000001',
        xiaomiAppKey: '5852000000001',
      }),
    ).toEqual({
      'ai.biber.push.xiaomi.app_id': 'biber:2882303761520000001',
      'ai.biber.push.xiaomi.app_key': 'biber:5852000000001',
      'com.huawei.hms.client.appid': 'appid=104000001',
      'com.vivo.push.api_key': 'abc',
      'com.vivo.push.app_id': '105000002',
    });
  });

  it('adds the Huawei and Honor repositories once', () => {
    const gradle = 'allprojects {\n  repositories {\n    google()\n  }\n}';
    const once = addMakerRepositories(gradle);

    expect(once).toContain("maven { url 'https://developer.huawei.com/repo/' }");
    expect(once).toContain("maven { url 'https://developer.hihonor.com/repo' }");
    expect(addMakerRepositories(once)).toBe(once);
  });
});
