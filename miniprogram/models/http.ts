import { LOCAL_SERVER_URL } from '../config'

/**
 * 本地数据服务的 HTTP 请求封装（仅 USE_LOCAL_SERVER=true 时使用）。
 * 统一走 wx.request，成功时返回 res.data，非 2xx 或网络失败时 reject。
 */

type Method = 'GET' | 'POST' | 'DELETE'

function request<T>(method: Method, path: string, data?: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    wx.request({
      url: LOCAL_SERVER_URL + path,
      method,
      data: data as Record<string, unknown>,
      timeout: 5000,
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
