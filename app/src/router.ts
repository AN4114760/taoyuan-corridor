import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/feedback' },
    { path: '/feedback', component: () => import('./views/Feedback.vue'), meta: { title: '志工回饋' } },
    {
      path: '/admin',
      component: () => import('./views/admin/AdminLayout.vue'),
      children: [
        { path: '', redirect: '/admin/map' },
        { path: 'map', component: () => import('./views/admin/MapView.vue'), meta: { title: '地圖' } },
        { path: 'progress', component: () => import('./views/admin/Progress.vue'), meta: { title: '執行情況' } },
        { path: 'review', component: () => import('./views/admin/Review.vue'), meta: { title: '複查情況' } },
        { path: 'voices', component: () => import('./views/admin/Voices.vue'), meta: { title: '志工回饋' } },
        { path: 'priorities', component: () => import('./views/admin/Priorities.vue'), meta: { title: '需改善路段' } },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/feedback' },
  ],
})

router.afterEach((to) => {
  const t = to.meta.title as string | undefined
  document.title = t ? `${t}｜無障礙廊道` : '無障礙廊道'
})
