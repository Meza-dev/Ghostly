export function Spinner() {
  return (
    <div data-testid="spinner" className="flex items-center justify-center py-10">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600" />
    </div>
  );
}
