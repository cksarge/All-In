select email,
       created_at,
       confirmation_sent_at,
       email_confirmed_at,
       raw_user_meta_data->>'username' as username
from auth.users
order by created_at desc
limit 5;