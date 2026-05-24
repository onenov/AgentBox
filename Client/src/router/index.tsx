import type { RouteObject } from 'react-router-dom'
import { createBrowserRouter } from 'react-router-dom'
import generatedRoutes from 'virtual:generated-pages-react'
import DefaultLayout from '@/layouts/Default'
import ErrorPage from './ErrorPage'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <DefaultLayout />,
    errorElement: <ErrorPage />,
    children: [...generatedRoutes, { path: '*', element: <ErrorPage /> }] as RouteObject[],
  },
])
