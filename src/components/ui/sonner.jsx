import { Toaster as Sonner } from "sonner"

const Toaster = (props) => {
  return (
    <Sonner
      theme="light"
      position="top-center"
      dir="rtl"
      richColors
      toastOptions={{
        style: {
          fontFamily: 'system-ui, -apple-system, sans-serif',
          direction: 'rtl',
        },
      }}
      {...props}
    />
  );
}

export { Toaster }
