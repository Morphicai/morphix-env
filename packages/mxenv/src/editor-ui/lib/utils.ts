// Single cn implementation for the editor UI: shadcn registry components
// import `cn` from the "cn" package directly, so re-export it here instead of
// stacking a second clsx+tailwind-merge implementation into the bundle.
export { cn } from 'cn'
