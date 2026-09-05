import { LOCAL_SERVER_URL, REQUEST_TIMEOUT } from '../config'

/**
 * 本地数据服务的 HTTP 请求封装。
 * 页面不要直接调 wx.request —— 走 models/{record,profile} 再落到这里。
 *
 * 成功时返回 res.data；非 2xx 或网络失败时 reject 成带中文提示的 Error。
 * 「连不上」是最常见的失败（服务没启动 / 真机没改局域网 IP），所以提示里带上地址。
 */

type Method = 'GET' | 'POST' | 'DELETE'

function request<T>(method: Method, path: string, data?: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    wx.request({
      url: LOCAL_SERVER_URL + path,
      method,
      data: data as Record<string, unknown>,
      timeout: REQUEST_TIMEOUT,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data as T)
        } else {
          const msg = (res.data as { error?: string } | undefined)?.error
          reject(new Error(`本地服务 HTTP ${res.statusCode}${msg ? ': ' + msg : ''}`))
        }
      },
      fail(err) {
        reject(new Error(`连不上本地服务（${LOCAL_SERVER_URL}）：${err.errMsg}。请先运行 local-server/start-server.bat`))
      },
    })
  })
}

export function httpGet<T>(path: string): Promise<T> {
  return request<T>('GET', path)
}

export function httpPost<T>(path: string, data?: unknown): Promise<T> {
  return request<T>('POST', path, data)
}

export function httpDelete<T>(path: string): Promise<T> {
  return request<T>('DELETE', path)
}
