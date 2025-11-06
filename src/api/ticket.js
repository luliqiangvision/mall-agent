import request from '@/utils/request'

// 获取工单列表
export function getTicketList(params) {
  return request({
    url: '/tickets',
    method: 'get',
    params
  })
}

// 获取工单详情
export function getTicketDetail(ticketId) {
  return request({
    url: `/tickets/${ticketId}`,
    method: 'get'
  })
}

// 创建工单
export function createTicket(data) {
  return request({
    url: '/tickets',
    method: 'post',
    data
  })
}

// 更新工单
export function updateTicket(ticketId, data) {
  return request({
    url: `/tickets/${ticketId}`,
    method: 'put',
    data
  })
}

// 分配工单
export function assignTicket(ticketId, assigneeId) {
  return request({
    url: `/tickets/${ticketId}/assign`,
    method: 'post',
    data: { assigneeId }
  })
}

// 关闭工单
export function closeTicket(ticketId) {
  return request({
    url: `/tickets/${ticketId}/close`,
    method: 'post'
  })
}
