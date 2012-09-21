require "sinatra"

class Pedometer < Sinatra::Base

  get "/" do
    erb pedometer
  end

  run!

end
