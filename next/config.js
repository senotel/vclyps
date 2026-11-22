/* next/config.js: the switches that turn the previews into the real thing.
   Empty values keep the labelled PREVIEW (nothing leaves the device, nothing
   is charged). These two values are public by design (Supabase's URL and its
   publishable/anon key are meant for browsers; Row Level Security protects
   the data). Secret keys never go here: Polar's token and Supabase's
   service_role key live only in Supabase's secrets (supabase/SETUP.md). */
window.OUTCLIP_CONFIG = {
  supabaseUrl: "",       // https://<project-ref>.supabase.co
  supabaseKey: "",       // the anon / publishable key
  payments: false        // true once Polar is connected (the bank account is linked)
};
