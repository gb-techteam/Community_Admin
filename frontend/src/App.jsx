import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Login from "./pages/Login.jsx";
import Overview from "./pages/Overview.jsx";
import Students from "./pages/Students.jsx";
import Courses from "./pages/Courses.jsx";
import Batches from "./pages/Batches.jsx";
import Channels from "./pages/Channels.jsx";
import ChannelMessages from "./pages/ChannelMessages.jsx";
import Admins from "./pages/Admins.jsx";
import Superkandle from "./pages/Superkandle.jsx";
import Momentum from "./pages/Momentum.jsx";
import DashboardLayout from "./layouts/DashboardLayout.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import PowerRoute from "./components/PowerRoute.jsx";
import { FeedbackProvider } from "./lib/feedback.jsx";

export default function App() {
  return (
    <FeedbackProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Overview />} />
            <Route
              path="students"
              element={
                <PowerRoute powers={["manage_students"]}>
                  <Students />
                </PowerRoute>
              }
            />
            <Route
              path="courses"
              element={
                <PowerRoute powers={["manage_courses"]}>
                  <Courses />
                </PowerRoute>
              }
            />
            <Route
              path="batches"
              element={
                <PowerRoute powers={["manage_batches"]}>
                  <Batches />
                </PowerRoute>
              }
            />
            <Route
              path="channels"
              element={
                <PowerRoute
                  powers={[
                    "manage_channels",
                    "message_channels",
                    "view_channel_people",
                  ]}
                >
                  <Channels />
                </PowerRoute>
              }
            />
            <Route
              path="channels/:id"
              element={
                <PowerRoute
                  powers={[
                    "manage_channels",
                    "message_channels",
                    "view_channel_people",
                  ]}
                >
                  <ChannelMessages />
                </PowerRoute>
              }
            />
            <Route
              path="superkandle"
              element={
                <PowerRoute powers={["manage_superkandle"]}>
                  <Superkandle />
                </PowerRoute>
              }
            />
            <Route
              path="momentum"
              element={
                <PowerRoute powers={["manage_momentum"]}>
                  <Momentum />
                </PowerRoute>
              }
            />
            <Route
              path="admins"
              element={
                <PowerRoute powers={["create_admins"]}>
                  <Admins />
                </PowerRoute>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </FeedbackProvider>
  );
}
