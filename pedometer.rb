require "sinatra"

class Pedometer < Sinatra::Base

  set :port, ENV["PORT"] || 4567

  get "/" do
    erb :pedometer
  end

  run!

end
