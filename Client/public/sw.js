// Service Worker - 清除所有旧缓存，仅满足PWA安装要求
// 不做任何缓存，避免缓存问题

self.addEventListener('install', (event) => {
    // 立即激活，跳过等待
    self.skipWaiting();
    
    // 清除所有旧缓存
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        console.log('清除所有旧缓存:', cacheNames);
        return Promise.all(
          cacheNames.map((cacheName) => {
            console.log('删除缓存:', cacheName);
            return caches.delete(cacheName);
          })
        );
      })
    );
  });
  
  self.addEventListener('activate', (event) => {
    // 立即获取控制权并清除所有缓存
    event.waitUntil(
      Promise.all([
        self.clients.claim(),
        // 再次确保清除所有缓存
        caches.keys().then((cacheNames) => {
          return Promise.all(
            cacheNames.map((cacheName) => {
              console.log('激活时删除缓存:', cacheName);
              return caches.delete(cacheName);
            })
          );
        })
      ])
    );
  });
  
  self.addEventListener('fetch', (event) => {
    // 不做任何缓存处理，直接走网络
    // 这样就不会有缓存问题了
    return;
  }); 